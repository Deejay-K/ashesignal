// Market regime: what BTC is doing, how broad the move is, and whether alts are leading.
// Feeds the conditions banner and the Confirmed gate (no confirmed alt longs in a confirmed BTC downtrend, and vice versa).

import { getMarkets } from "@/lib/providers/coingecko";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { sma } from "@/lib/ta/indicators";
import { safe } from "@/lib/fetch";

export type Trend = "up" | "down" | "sideways";
export interface Regime {
  btc: { trend: Trend; score: number; price: number; sma200: number | null; sma50: number | null; atrPct: number; regime: string; change7d: number | null; change30d: number | null };
  breadth: { above200: number; above50: number; sample: number; label: "broad advance" | "narrow" | "broad decline" | "mixed" };
  alts: { altSeason: number; label: "alt season" | "alts leading" | "balanced" | "BTC season"; btcDominance: number | null };
  label: "risk-on" | "risk-off" | "choppy" | "transition";
  headline: string;
  advice: string;
  generatedAt: number;
}

let cache: { at: number; value: Regime } | null = null;

export async function marketRegime(): Promise<Regime | null> {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.value;
  const [btcR, top] = await Promise.all([safe(getOhlcv({ symbol: "BTC", coingeckoId: "bitcoin" }, "1d", 400)), safe(getMarkets(1, 100, false))]);
  if (!btcR.ok || btcR.data.candles.length < 200) return cache?.value ?? null;
  const closes = btcR.data.candles.map((c) => c.close);
  const a = analyzeTimeframe("1d", btcR.data.candles);
  if (!a) return cache?.value ?? null;
  const n = closes.length;
  const s200 = sma(closes, 200)[n - 1] ?? null;
  const s50 = sma(closes, 50)[n - 1] ?? null;
  const price = closes[n - 1];
  const btcTrend: Trend = s200 != null && s50 != null ? (price > s200 && s50 > s200 ? "up" : price < s200 && s50 < s200 ? "down" : "sideways") : a.trend.direction;
  const coins = top.ok ? top.data.filter((c) => !/usd|dai|wbtc|weth|steth/i.test(c.symbol)) : [];
  // breadth from CoinGecko sparkline-free fields: use 30d and 7d changes as proxy for "above 50/200" when candles unavailable
  const btc7 = top.ok ? top.data.find((c) => c.id === "bitcoin")?.change7dPct ?? null : null;
  const btc30 = top.ok ? top.data.find((c) => c.id === "bitcoin")?.change30dPct ?? null : null;
  const sample = coins.length;
  const above50 = sample ? Math.round((100 * coins.filter((c) => (c.change30dPct ?? 0) > 0).length) / sample) : 0;
  const above200 = sample ? Math.round((100 * coins.filter((c) => (c.change1yPct ?? c.change30dPct ?? 0) > 0).length) / sample) : 0;
  const breadthLabel: Regime["breadth"]["label"] = above50 >= 65 ? "broad advance" : above50 <= 35 ? "broad decline" : above50 >= 50 && btcTrend === "up" ? "narrow" : "mixed";
  // alt season: share of top-50 alts beating BTC over 30 d (75%+ = alt season)
  const alts = coins.filter((c) => c.id !== "bitcoin").slice(0, 50);
  const beating = alts.filter((c) => (c.change30dPct ?? -999) > (btc30 ?? 0)).length;
  const altSeason = alts.length ? Math.round((100 * beating) / alts.length) : 50;
  const altLabel: Regime["alts"]["label"] = altSeason >= 75 ? "alt season" : altSeason >= 55 ? "alts leading" : altSeason >= 35 ? "balanced" : "BTC season";
  const dom = top.ok ? (() => { const tot = top.data.reduce((s, c) => s + (c.marketCapUsd ?? 0), 0); const b = top.data.find((c) => c.id === "bitcoin")?.marketCapUsd ?? 0; return tot ? Math.round((1000 * b) / tot) / 10 : null; })() : null;
  const label: Regime["label"] = btcTrend === "up" && above50 >= 50 ? "risk-on" : btcTrend === "down" && above50 <= 50 ? "risk-off" : btcTrend === "sideways" ? "choppy" : "transition";
  const headline = label === "risk-on" ? `Risk-on: BTC in an uptrend (above the 200-day), ${above50}% of the top 100 up over 30 days${altLabel === "alt season" ? ", alt season" : ""}.`
    : label === "risk-off" ? `Risk-off: BTC in a downtrend (below the 200-day), only ${above50}% of the top 100 up over 30 days.`
    : label === "choppy" ? `Choppy: BTC has no daily trend; ${above50}% of the top 100 up over 30 days.`
    : `Transition: BTC trend ${btcTrend} but breadth disagrees (${above50}% up over 30 days).`;
  const advice = label === "risk-on" ? "Favour longs; shorts need a strong individual reason." : label === "risk-off" ? "Favour shorts or stay flat; alt longs fail most often here. Spot accumulation zones are where longs make sense." : label === "choppy" ? "Range tactics: fade extremes, expect breakouts to fail more often; smaller size." : "Wait for agreement between BTC and breadth before taking size.";
  const value: Regime = { btc: { trend: btcTrend, score: a.score, price, sma200: s200, sma50: s50, atrPct: +(a.volatility.atrPct * 100).toFixed(2), regime: a.volatility.regime, change7d: btc7, change30d: btc30 }, breadth: { above200, above50, sample, label: breadthLabel }, alts: { altSeason, label: altLabel, btcDominance: dom }, label, headline, advice, generatedAt: Date.now() };
  cache = { at: Date.now(), value };
  return value;
}

/** Gate: should a confirmed setup on an altcoin be allowed in this regime? */
export function regimeAllows(r: Regime | null, symbol: string, side: "LONG" | "SHORT"): { ok: boolean; reason: string | null } {
  if (!r) return { ok: true, reason: null };
  const isBtc = symbol.toUpperCase() === "BTC";
  if (!isBtc && side === "LONG" && r.label === "risk-off") return { ok: false, reason: `Market regime is risk-off (${r.headline}) Alt longs against a BTC downtrend have the worst record; this waits for BTC to reclaim its 200-day or for breadth to turn.` };
  if (!isBtc && side === "SHORT" && r.label === "risk-on" && r.alts.altSeason >= 55) return { ok: false, reason: `Market regime is risk-on with alts leading (${r.alts.altSeason}% beat BTC over 30 d). Shorting alts into that is fighting the tape.` };
  return { ok: true, reason: null };
}
