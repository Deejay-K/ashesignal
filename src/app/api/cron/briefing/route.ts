import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/supabase/admin";
import { buildMarketBriefing } from "@/lib/ai/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Regenerates the market briefing (hourly via the worker) so the dashboard never waits on the model. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = await buildMarketBriefing(true);
    return NextResponse.json({ ok: true, headline: (b as { briefing: { headline: string } }).briefing.headline, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
