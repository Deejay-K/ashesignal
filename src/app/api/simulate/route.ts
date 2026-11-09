import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { simulate, SIM_DEFAULTS } from "@/lib/simulator";
import { isVenueId } from "@/lib/venues";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "no database" }, { status: 501 });
  const q = req.nextUrl.searchParams;
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const list = (k: string, d: string[]) => (q.get(k) ? q.get(k)!.split(",").filter(Boolean) : d);
  const venueQ = q.get("venue");
  const r = await simulate(sb, { balance: num("balance", SIM_DEFAULTS.balance), riskPct: Math.min(10, num("risk", SIM_DEFAULTS.riskPct)), kinds: list("kinds", SIM_DEFAULTS.kinds), timeframes: list("tfs", SIM_DEFAULTS.timeframes), venue: venueQ && isVenueId(venueQ) ? venueQ : null, maxOpen: Math.min(20, num("maxOpen", SIM_DEFAULTS.maxOpen)), sinceDays: Math.min(730, num("days", SIM_DEFAULTS.sinceDays)) });
  return NextResponse.json(r);
}
