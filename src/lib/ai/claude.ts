// LLM access with three tiers - all optional:
//   1. ANTHROPIC_API_KEY                         → Claude Messages API
//   2. AI_API_KEY + AI_BASE_URL (+ AI_MODEL)     → any OpenAI-compatible endpoint
//        Groq (free):   AI_BASE_URL=https://api.groq.com/openai/v1        AI_MODEL=llama-3.3-70b-versatile
//        Gemini (free): AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_MODEL=gemini-2.0-flash
//        OpenRouter:    AI_BASE_URL=https://openrouter.ai/api/v1          AI_MODEL=<any free model>
//   3. nothing set                               → local template writer (src/lib/ai/local.ts), always available

export type AiProvider = "anthropic" | "openai-compatible" | "local";

export function aiProvider(): AiProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.AI_API_KEY && process.env.AI_BASE_URL) return "openai-compatible";
  return "local";
}
export const AI_ENABLED = () => true; // local writer always works
export const AI_MODEL = () => process.env.AI_MODEL ?? (aiProvider() === "anthropic" ? "claude-haiku-5-5" : aiProvider() === "openai-compatible" ? "llama-3.3-70b-versatile" : "engine-writer");

export interface ClaudeResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function parseJson<T>(text: string): T {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return JSON.parse(text.slice(a, b + 1)) as T;
}

/** Ask the configured model for a JSON object. Throws if no remote provider is configured. */
export async function askJson<T>(system: string, user: string, maxTokens = 1800): Promise<ClaudeResult<T>> {
  const provider = aiProvider();
  if (provider === "local") throw new Error("no remote LLM configured");

  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY!;
    const call = async (extra = "") => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: AI_MODEL(), max_tokens: maxTokens, system, messages: [{ role: "user", content: user + extra }, { role: "assistant", content: "{" }] }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number }; model: string };
      return { text: "{" + (j.content.find((c) => c.type === "text")?.text ?? ""), j };
    };
    let { text, j } = await call();
    let data: T;
    try {
      data = parseJson<T>(text);
    } catch {
      ({ text, j } = await call("\n\nYour previous reply was not valid JSON. Reply with ONLY a JSON object."));
      data = parseJson<T>(text);
    }
    return { data, model: j.model, inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens };
  }

  // OpenAI-compatible
  const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
  const call = async (extra = "") => {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL(), max_tokens: maxTokens, temperature: 0.4, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user + extra }] }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; model?: string };
    return { text: j.choices[0]?.message?.content ?? "", j };
  };
  let { text, j } = await call();
  let data: T;
  try {
    data = parseJson<T>(text);
  } catch {
    ({ text, j } = await call("\n\nYour previous reply was not valid JSON. Reply with ONLY a JSON object."));
    data = parseJson<T>(text);
  }
  return { data, model: j.model ?? AI_MODEL(), inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
}
