import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { venueFromRequest } from "@/lib/venue-pref";
import { VENUE_META } from "@/lib/venues";
import { marketRegime } from "@/lib/market/regime";
import { getFearGreed } from "@/lib/providers/feargreed";
import { loadDiscovery, tradeableOn } from "@/lib/market/discovery";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Stage 42 - the one sentence at the top of the dashboard: where the market is, and what that means for you today. */
export async function GET(req: NextRequest) {
  const venue = venueFromRequest(req);
  const vm = VENUE_META[venue];
  const [reg, fng, disc] = await Promise.all([safe(marketRegime()), safe(getFearGreed(1)), safe(loadDiscovery(supabaseAdmin(), { venue, verifyBudgetMs: 1 }))]);
  const r = reg.ok ? reg.data : null;
  const f = fng.ok ? fng.data[0] : null;
  const items = disc.ok ? tradeableOn(disc.data.items, venue) : [];
  const confirmed = items.filter((i) => i.category === "confirmed");
  const watching = items.filter((i) => i.category === "watching").length;
  const facts: string[] = [];
  if (r) facts.push(`Bitcoin trend ${r.btc.trend}`);
  if (r?.alts.btcDominance != null) facts.push(`BTC dominance ${r.alts.btcDominance.toFixed(0)}%`);
  if (f) facts.push(`Fear & Greed ${f.value}${f.label ? ` (${String(f.label).toLowerCase()})` : ""}`);
  const label = r?.label ?? null;
  const stance = confirmed.length
    ? `${confirmed.length} Confirmed trade${confirmed.length === 1 ? "" : "s"} you can place on ${vm.label}: ${confirmed.slice(0, 3).map((i) => `${i.symbol} ${i.side ?? ""}`.trim()).join(", ")}${confirmed.length > 3 ? " and more" : ""}.`
    : `No Confirmed trades for ${vm.label}${vm.canShort ? "" : " (longs only)"}; ${watching} being watched.`;
  const move = confirmed.length
    ? label === "risk-off" ? "The market is weak, so keep size small and respect the stop." : "Check the entry zone before you buy; do not chase."
    : label === "risk-off" ? "Best move today: stay in cash and wait." : label === "choppy" ? "Best move today: be patient, the market has no clear direction." : "Best move today: wait for a setup to confirm.";
  const tone = label === "risk-off" ? "down" : label === "risk-on" ? "up" : "amber";
  return NextResponse.json({ label, tone, title: label ? `${label[0].toUpperCase()}${label.slice(1)} market` : "Market today", facts, stance, move, confirmed: confirmed.length, watching, venue: vm.label, at: new Date().toISOString() });
}
