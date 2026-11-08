import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { preTradeChecks, accountForChecks } from "@/lib/trade-check";
import { isVenueId } from "@/lib/venues";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";

/** GET pre-trade checklist. Works for guests (no heat check); signed-in users get the heat check too. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const symbol = (q.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const venueQ = q.get("venue");
  const venue = venueQ && isVenueId(venueQ) ? venueQ : venueFromRequest(req);
  const sb = await supabaseServer();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  const account = sb && user ? await accountForChecks(sb, user.id) : null;
  const low = n("entryLow"), high = n("entryHigh");
  const r = await preTradeChecks({ symbol, side: q.get("side") === "SHORT" ? "SHORT" : "LONG", kind: q.get("kind") ?? "watch", price: n("price"), entry: low && high ? { low, high } : null, stop: n("stop"), venue, riskUsd: n("risk"), confirmGaps: q.get("gap") ? [q.get("gap")!] : undefined, account });
  return NextResponse.json(r);
}
