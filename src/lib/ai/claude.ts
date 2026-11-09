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

/** Model that answered last (reused first next time). */
let workingModel: string | null = null;
/** Configured model first, then current models for the provider behind AI_BASE_URL. */
export function modelChain(base = process.env.AI_BASE_URL ?? ""): string[] {
  const configured = process.env.AI_MODEL;
  const fallbacks = /generativelanguage\.googleapis\.com/.test(base) ? ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
    : /groq\.com/.test(base) ? ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] : [];
  return [...new Set([workingModel, configured, ...fallbacks].filter(Boolean) as string[])];
}

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

  // OpenAI-compatible (Groq, Gemini, ...). Models get retired (gemini-2.0-flash was shut down on 2026-06-01), so on
  // "model not found" the call moves through a list of current models and remembers the first one that works.
  const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
  const models = modelChain(base);
  const call = async (extra = "") => {
    let lastErr = "";
    for (const model of models) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AI_API_KEY}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.4, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user + extra }] }),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        workingModel = model;
        const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; model?: string };
        return { text: j.choices[0]?.message?.content ?? "", j: { ...j, model: j.model ?? model } };
      }
      const body = (await res.text()).slice(0, 300);
      lastErr = `LLM HTTP ${res.status} (${model}): ${body}`;
      // Only a missing or retired model is worth trying the next one; auth, quota and other errors stop here.
      const modelGone = res.status === 404 || (res.status === 400 && /model|not found|not supported|deprecat|retired|unknown/i.test(body));
      if (!modelGone) break;
      console.error("[ai] model unavailable, trying next:", lastErr);
    }
    throw new Error(lastErr || "LLM call failed");
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
