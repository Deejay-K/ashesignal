// Swing pivots, support/resistance clustering, trendlines.

import type { Candle } from "@/lib/types";

export interface Pivot {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
}

/** Fractal pivots: a high/low that is the extreme within ±left/right bars. */
export function findPivots(candles: Candle[], left = 3, right = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= h) isHigh = false;
      if (candles[j].low <= l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, time: candles[i].time, price: h, kind: "high" });
    if (isLow) out.push({ index: i, time: candles[i].time, price: l, kind: "low" });
  }
  return out;
}

export interface Level {
  price: number;
  touches: number;
  kind: "support" | "resistance";
  strength: number; // 0-1
  lastTouchTime: number;
}

/**
 * Cluster pivot prices into zones. Tolerance is a fraction of price (e.g. 0.004 = 0.4%).
 * A level is "support" if below current price, "resistance" if above.
 */
export function supportResistance(candles: Candle[], pivots: Pivot[], tolerance = 0.006, maxLevels = 6): Level[] {
  if (!candles.length) return [];
  const price = candles[candles.length - 1].close;
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; times: number[]; vol: number }[] = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(p.price - c.prices[c.prices.length - 1]) / p.price <= tolerance) {
      c.prices.push(p.price);
      c.times.push(p.time);
    } else clusters.push({ prices: [p.price], times: [p.time], vol: 0 });
  }
  const maxTouch = Math.max(1, ...clusters.map((c) => c.prices.length));
  const lastTime = candles[candles.length - 1].time;
  const firstTime = candles[0].time;
  const levels: Level[] = clusters.map((c) => {
    const avg = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    const recency = (Math.max(...c.times) - firstTime) / Math.max(1, lastTime - firstTime);
    const strength = Math.min(1, 0.6 * (c.prices.length / maxTouch) + 0.4 * recency);
    return { price: avg, touches: c.prices.length, kind: avg < price ? "support" : "resistance", strength, lastTouchTime: Math.max(...c.times) };
  });
  // keep the strongest nearest levels on each side
  const sup = levels.filter((l) => l.kind === "support").sort((a, b) => b.strength - a.strength).slice(0, maxLevels);
  const res = levels.filter((l) => l.kind === "resistance").sort((a, b) => b.strength - a.strength).slice(0, maxLevels);
  return [...sup, ...res].sort((a, b) => a.price - b.price);
}

export interface Trendline {
  kind: "support" | "resistance";
  from: { time: number; price: number };
  to: { time: number; price: number };
  slopePerBar: number;
  touches: number;
}

/** Fit a line through the last two major pivots of a kind and count how many pivots touch it. */
export function trendlines(candles: Candle[], pivots: Pivot[], tolerance = 0.01): Trendline[] {
  const out: Trendline[] = [];
  for (const kind of ["low", "high"] as const) {
    const ps = pivots.filter((p) => p.kind === kind).slice(-6);
    if (ps.length < 2) continue;
    let best: Trendline | null = null;
    for (let i = 0; i < ps.length - 1; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const slope = (b.price - a.price) / (b.index - a.index);
        let touches = 0;
        for (const p of ps) {
          const y = a.price + slope * (p.index - a.index);
          if (Math.abs(p.price - y) / p.price <= tolerance) touches++;
        }
        const lastIdx = candles.length - 1;
        const tl: Trendline = {
          kind: kind === "low" ? "support" : "resistance",
          from: { time: a.time, price: a.price },
          to: { time: candles[lastIdx].time, price: a.price + slope * (lastIdx - a.index) },
          slopePerBar: slope,
          touches,
        };
        if (!best || touches > best.touches || (touches === best.touches && j > i)) best = tl;
      }
    }
    if (best && best.touches >= 2) out.push(best);
  }
  return out;
}
