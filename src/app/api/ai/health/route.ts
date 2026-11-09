import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/supabase/admin";
import { askJson, aiProvider, modelChain } from "@/lib/ai/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Checks the AI setup with one tiny request. /api/ai/health?secret=CRON_SECRET. Never returns the key. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const provider = aiProvider();
  const info = { provider, baseUrl: process.env.AI_BASE_URL ? new URL(process.env.AI_BASE_URL).host : null, configuredModel: process.env.AI_MODEL ?? null, keySet: !!(process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY), modelsTried: modelChain() };
  if (provider === "local") return NextResponse.json({ ok: false, ...info, problem: "No AI configured: set AI_BASE_URL + AI_API_KEY (or ANTHROPIC_API_KEY) in Vercel and redeploy." });
  const t = Date.now();
  try {
    const r = await askJson<{ reply: string }>("Reply with JSON only.", 'Return {"reply":"pong"}', 200);
    return NextResponse.json({ ok: true, ...info, answeredBy: r.model, reply: r.data?.reply ?? null, ms: Date.now() - t, tip: info.configuredModel && r.model && !r.model.includes(info.configuredModel) ? `Your AI_MODEL (${info.configuredModel}) is unavailable; set AI_MODEL=${r.model} in Vercel to skip the retry.` : undefined });
  } catch (e) {
    return NextResponse.json({ ok: false, ...info, error: (e as Error).message, ms: Date.now() - t });
  }
}
