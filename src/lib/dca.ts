// Stage 38 - DCA planner: split a spot buy into limit orders across a buy zone (the spot pick's accumulation zone,
// or the zone between the nearest daily support and today's price), with the average price if all, or only some,
// fill. Pure math plus a zone resolver; nothing is sent to an exchange.

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeAsset } from "./market/analyze";
import { safe } from "./fetch";

export type DcaWeighting = "even" | "heavier-low";
export interface DcaOrder { n: number; price: number; usd: number; units: number }
export interface DcaPlan {
  symbol: string; price: number; zone: { low: number; high: number }; zoneSource: string; budget: number; weighting: DcaWeighting;
  orders: DcaOrder[]; avgIfAll: number; unitsIfAll: number; partial: { filled: number; avg: number; usd: number }[];
  reviewLevel: number; reviewNote: string; takeProfit: { label: string; price: number }[]; notes: string[];
}

/** The ladder itself. Prices step from the top of the zone (or the current price if lower) down to the bottom. */
export function planLadder(o: { symbol: string; price: number; zone: { low: number; high: number }; budget: number; count: number; weighting: DcaWeighting; zoneSource: string; takeProfit?: { label: string; price: number }[] }): DcaPlan {
  const n = Math.max(2, Math.min(8, Math.round(o.count)));
  const top = Math.min(o.zone.high, o.price);
  const bottom = Math.min(o.zone.low, top);
  const step = n > 1 ? (top - bottom) / (n - 1) : 0;
  const w = Array.from({ length: n }, (_, i) => (o.weighting === "heavier-low" ? 1 + i * 0.25 : 1));
  const wSum = w.reduce((a, b) => a + b, 0);
  const round = (p: number) => (p >= 100 ? +p.toFixed(2) : p >= 1 ? +p.toFixed(4) : +p.toPrecision(4));
  const orders: DcaOrder[] = w.map((wi, i) => { const price = round(top - step * i); const usd = +((o.budget * wi) / wSum).toFixed(2); return { n: i + 1, price, usd, units: +(usd / price).toPrecision(6) }; });
  const partial = orders.map((_, k) => { const f = orders.slice(0, k + 1); const usd = f.reduce((s, x) => s + x.usd, 0); const units = f.reduce((s, x) => s + x.units, 0); return { filled: k + 1, avg: round(usd / units), usd: +usd.toFixed(2) }; });
  const all = partial[partial.length - 1];
  const reviewLevel = round(bottom * 0.85);
  const notes = [
    o.price > o.zone.high ? `Price is ${(((o.price - o.zone.high) / o.price) * 100).toFixed(1)}% above the zone: the first order waits for a pullback. If it never comes, that is fine; do not chase.` : o.price < o.zone.low ? "Price is already below the zone: the market is weaker than the plan assumed. Consider fewer, smaller orders and a lower review level." : "Price is inside the zone: the first order can fill right away.",
    "Place all orders as limit buys (GTC). Cancel the unfilled ones if the review level breaks.",
    o.weighting === "heavier-low" ? "Lower orders are bigger, so the average improves most if price dips." : "Equal-sized orders: simple and steady.",
  ];
  return { symbol: o.symbol, price: o.price, zone: { low: round(o.zone.low), high: round(o.zone.high) }, zoneSource: o.zoneSource, budget: o.budget, weighting: o.weighting, orders, avgIfAll: all.avg, unitsIfAll: +(all.usd / all.avg).toPrecision(6), partial, reviewLevel, reviewNote: `A daily close under ${reviewLevel} means the accumulation idea is wrong: stop buying and reassess (spot has no forced stop, this is your decision line).`, takeProfit: (o.takeProfit ?? []).slice(0, 3), notes };
}

/** Find the buy zone for a coin: spot pick accumulation zone first, else daily support up to the current price. */
export async function resolveZone(sb: SupabaseClient | null, coin: { id: string; symbol: string }): Promise<{ price: number; zone: { low: number; high: number }; source: string; takeProfit: { label: string; price: number }[] } | null> {
  if (sb) {
    const { data: sp } = await sb.from("spot_picks").select("price, detail").eq("asset_key", `cg:${coin.id}`).maybeSingle();
    const acc = sp?.detail?.analysis?.accumulation;
    if (acc && Number(sp?.price) > 0) return { price: Number(sp!.price), zone: { low: acc.low, high: acc.high }, source: "Spot pick accumulation zone", takeProfit: sp!.detail.analysis.profitTaking ?? [] };
  }
  const a = await safe(analyzeAsset({ symbol: coin.symbol, coingeckoId: coin.id }, ["1d"]));
  const t = a.ok ? a.data.timeframes["1d"] : null;
  if (!t || "unavailable" in t) return null;
  const supports = t.levels.filter((l) => l.price < t.price).sort((x, y) => y.price - x.price);
  const resist = t.levels.filter((l) => l.price > t.price).sort((x, y) => x.price - y.price);
  const low = supports[1]?.price ?? supports[0]?.price ?? t.price * 0.85;
  return { price: t.price, zone: { low, high: t.price }, source: supports.length ? "Daily supports below the current price" : "15% under the current price (no daily support found)", takeProfit: resist.slice(0, 3).map((r, i) => ({ label: `Resistance ${i + 1}`, price: r.price })) };
}
