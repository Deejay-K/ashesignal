// The one-sentence market headline (dashboard, bot /today, daily plan): where the market is and what that means
// for this user's exchange today. Cached for a minute per exchange so the dashboard and the bot never rebuild it
// back to back.

import type { SupabaseClient } from "@supabase/supabase-js";
import { VENUE_META, type VenueId } from "./venues";
import { marketRegime } from "./market/regime";
import { getFearGreed } from "./providers/feargreed";
import { loadDiscoveryCached, tradeableOn } from "./market/discovery";
import { safe } from "./fetch";

export interface Headline { label: string | null; tone: "up" | "down" | "amber"; title: string; facts: string[]; stance: string; move: string; confirmed: number; watching: number; venue: string; at: string }

const memo = new Map<string, { at: number; value: Headline }>();

export async function buildHeadline(sb: SupabaseClient | null, venue: VenueId): Promise<Headline> {
  const hit = memo.get(venue);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const vm = VENUE_META[venue];
  const [reg, fng, disc] = await Promise.all([safe(marketRegime()), safe(getFearGreed(1)), safe(loadDiscoveryCached(sb, { venue, verifyBudgetMs: 1 }))]);
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
  const value: Headline = { label, tone: label === "risk-off" ? "down" : label === "risk-on" ? "up" : "amber", title: label ? `${label[0].toUpperCase()}${label.slice(1)} market` : "Market today", facts, stance, move, confirmed: confirmed.length, watching, venue: vm.label, at: new Date().toISOString() };
  if (reg.ok || disc.ok) memo.set(venue, { at: Date.now(), value });
  return value;
}
