import { NextRequest, NextResponse } from "next/server";
import { answer } from "@/lib/ai/assistant";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { venueFromRequest } from "@/lib/venue-pref";
import { ensureEngineConfig } from "@/lib/engine-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bucket = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  await ensureEngineConfig();
  const b = await req.json().catch(() => null);
  const q = String(b?.question ?? "").trim();
  if (q.length < 2) return NextResponse.json({ error: "Ask something." }, { status: 400 });
  // light rate limit per IP: 20 questions / 10 min
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const now = Date.now();
  const arr = (bucket.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (arr.length >= 20) return NextResponse.json({ error: "Slow down a little: 20 questions per 10 minutes." }, { status: 429 });
  arr.push(now); bucket.set(ip, arr);
  const sb = await supabaseServer();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  try {
    const a = await answer({ question: q, venue: venueFromRequest(req), userId: user?.id ?? null, sb, adminSb: supabaseAdmin(), history: Array.isArray(b?.history) ? b.history.slice(-6) : [] });
    return NextResponse.json({ ...a, context: undefined, signedIn: !!user });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
