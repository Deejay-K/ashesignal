// Chart pattern detection. Each detector is deliberately conservative and
// reports a status so the UI never presents a forming pattern as confirmed.
//
//   completed  — pattern finished and its breakout/breakdown already happened
//   forming    — structure is present but the trigger has not fired
//   potential  — early structure; speculative
//
// Detectors work on swing pivots (see levels.ts), which makes them timeframe-agnostic.

import type { Candle } from "@/lib/types";
import { findPivots, type Pivot } from "./levels";
import { normalizedSlope } from "./indicators";

export type PatternStatus = "completed" | "forming" | "potential";
export type Bias = "bullish" | "bearish";

export interface Pattern {
  name: string;
  bias: Bias;
  status: PatternStatus;
  confidence: number; // 0-1
  startTime: number;
  endTime: number;
  keyLevel?: number; // neckline / breakout level
  target?: number;
  description: string;
}

const pctDiff = (a: number, b: number) => Math.abs(a - b) / ((a + b) / 2);

export function detectPatterns(candles: Candle[]): Pattern[] {
  if (candles.length < 40) return [];
  const pivots = findPivots(candles, 3, 3);
  const out: Pattern[] = [];
  const lastClose = candles[candles.length - 1].close;

  out.push(...engulfing(candles));
  out.push(...structure(pivots, candles));
  out.push(...doubleTopBottom(pivots, candles, lastClose));
  out.push(...headAndShoulders(pivots, candles, lastClose));
  out.push(...wedgesTrianglesFlags(pivots, candles, lastClose));
  out.push(...cupAndHandle(candles, pivots, lastClose));

  // de-duplicate by name keeping highest confidence, newest
  const byName = new Map<string, Pattern>();
  for (const p of out) {
    const k = p.name + p.status;
    const prev = byName.get(k);
    if (!prev || p.confidence > prev.confidence) byName.set(k, p);
  }
  return [...byName.values()].sort((a, b) => b.endTime - a.endTime);
}

/* ---------- candle patterns ---------- */

function engulfing(c: Candle[]): Pattern[] {
  const out: Pattern[] = [];
  const n = c.length;
  for (let i = Math.max(1, n - 5); i < n; i++) {
    const a = c[i - 1];
    const b = c[i];
    const bodyA = Math.abs(a.close - a.open);
    const bodyB = Math.abs(b.close - b.open);
    if (bodyB < bodyA * 1.2) continue;
    if (a.close < a.open && b.close > b.open && b.close > a.open && b.open < a.close) {
      out.push({ name: "Bullish Engulfing", bias: "bullish", status: i === n - 1 ? "forming" : "completed", confidence: 0.55, startTime: a.time, endTime: b.time, description: "A large green candle fully engulfed the prior red candle, suggesting buyers overpowered sellers." });
    }
    if (a.close > a.open && b.close < b.open && b.close < a.open && b.open > a.close) {
      out.push({ name: "Bearish Engulfing", bias: "bearish", status: i === n - 1 ? "forming" : "completed", confidence: 0.55, startTime: a.time, endTime: b.time, description: "A large red candle fully engulfed the prior green candle, suggesting sellers overpowered buyers." });
    }
  }
  return out;
}

/* ---------- market structure: HH/HL vs LH/LL ---------- */

function structure(p: Pivot[], c: Candle[]): Pattern[] {
  const highs = p.filter((x) => x.kind === "high").slice(-3);
  const lows = p.filter((x) => x.kind === "low").slice(-3);
  if (highs.length < 3 || lows.length < 3) return [];
  const hh = highs[2].price > highs[1].price && highs[1].price > highs[0].price;
  const hl = lows[2].price > lows[1].price && lows[1].price > lows[0].price;
  const lh = highs[2].price < highs[1].price && highs[1].price < highs[0].price;
  const ll = lows[2].price < lows[1].price && lows[1].price < lows[0].price;
  const start = Math.min(highs[0].time, lows[0].time);
  const end = c[c.length - 1].time;
  if (hh && hl) return [{ name: "Higher Highs & Higher Lows", bias: "bullish", status: "completed", confidence: 0.7, startTime: start, endTime: end, description: "Three consecutive higher swing highs and higher swing lows — a textbook uptrend structure." }];
  if (lh && ll) return [{ name: "Lower Highs & Lower Lows", bias: "bearish", status: "completed", confidence: 0.7, startTime: start, endTime: end, description: "Three consecutive lower swing highs and lower swing lows — a textbook downtrend structure." }];
  if (hl && !lh) return [{ name: "Higher Lows", bias: "bullish", status: "forming", confidence: 0.4, startTime: start, endTime: end, description: "Lows are rising while highs are not yet confirming — early bullish structure." }];
  if (lh && !hl) return [{ name: "Lower Highs", bias: "bearish", status: "forming", confidence: 0.4, startTime: start, endTime: end, description: "Highs are falling while lows have not broken down yet — early bearish structure." }];
  return [];
}

/* ---------- double top / bottom ---------- */

function doubleTopBottom(p: Pivot[], c: Candle[], lastClose: number): Pattern[] {
  const out: Pattern[] = [];
  const highs = p.filter((x) => x.kind === "high").slice(-4);
  const lows = p.filter((x) => x.kind === "low").slice(-4);
  // double top: two highs within 1.5%, with a trough between
  for (let i = 0; i < highs.length - 1; i++) {
    const a = highs[i];
    const b = highs[i + 1];
    if (b.index - a.index < 6 || pctDiff(a.price, b.price) > 0.015) continue;
    const trough = lows.filter((l) => l.index > a.index && l.index < b.index).sort((x, y) => x.price - y.price)[0];
    if (!trough || (a.price - trough.price) / a.price < 0.02) continue;
    const target = trough.price - (a.price - trough.price);
    const broke = lastClose < trough.price;
    out.push({ name: "Double Top", bias: "bearish", status: broke ? "completed" : "forming", confidence: broke ? 0.7 : 0.5, startTime: a.time, endTime: c[c.length - 1].time, keyLevel: trough.price, target, description: `Two swing highs near ${fmt(a.price)} with a neckline at ${fmt(trough.price)}. ${broke ? "Neckline broken — measured move points to " + fmt(target) + "." : "Confirmed only on a close below the neckline."}` });
  }
  for (let i = 0; i < lows.length - 1; i++) {
    const a = lows[i];
    const b = lows[i + 1];
    if (b.index - a.index < 6 || pctDiff(a.price, b.price) > 0.015) continue;
    const peak = highs.filter((h) => h.index > a.index && h.index < b.index).sort((x, y) => y.price - x.price)[0];
    if (!peak || (peak.price - a.price) / a.price < 0.02) continue;
    const target = peak.price + (peak.price - a.price);
    const broke = lastClose > peak.price;
    out.push({ name: "Double Bottom", bias: "bullish", status: broke ? "completed" : "forming", confidence: broke ? 0.7 : 0.5, startTime: a.time, endTime: c[c.length - 1].time, keyLevel: peak.price, target, description: `Two swing lows near ${fmt(a.price)} with a neckline at ${fmt(peak.price)}. ${broke ? "Neckline broken — measured move points to " + fmt(target) + "." : "Confirmed only on a close above the neckline."}` });
  }
  return out;
}

/* ---------- head & shoulders / inverse ---------- */

function headAndShoulders(p: Pivot[], c: Candle[], lastClose: number): Pattern[] {
  const out: Pattern[] = [];
  const highs = p.filter((x) => x.kind === "high").slice(-5);
  const lows = p.filter((x) => x.kind === "low").slice(-5);
  if (highs.length >= 3) {
    for (let i = 0; i <= highs.length - 3; i++) {
      const [l, h, r] = [highs[i], highs[i + 1], highs[i + 2]];
      if (h.price > l.price * 1.02 && h.price > r.price * 1.02 && pctDiff(l.price, r.price) < 0.04) {
        const necks = lows.filter((x) => x.index > l.index && x.index < r.index);
        if (necks.length < 2) continue;
        const neck = necks.reduce((a, b) => a + b.price, 0) / necks.length;
        const target = neck - (h.price - neck);
        const broke = lastClose < neck;
        out.push({ name: "Head and Shoulders", bias: "bearish", status: broke ? "completed" : "forming", confidence: broke ? 0.72 : 0.5, startTime: l.time, endTime: c[c.length - 1].time, keyLevel: neck, target, description: `Head at ${fmt(h.price)} flanked by shoulders near ${fmt(l.price)}/${fmt(r.price)}; neckline ≈ ${fmt(neck)}. ${broke ? "Neckline broken." : "Needs a close below the neckline to confirm."}` });
      }
    }
  }
  if (lows.length >= 3) {
    for (let i = 0; i <= lows.length - 3; i++) {
      const [l, h, r] = [lows[i], lows[i + 1], lows[i + 2]];
      if (h.price < l.price * 0.98 && h.price < r.price * 0.98 && pctDiff(l.price, r.price) < 0.04) {
        const necks = highs.filter((x) => x.index > l.index && x.index < r.index);
        if (necks.length < 2) continue;
        const neck = necks.reduce((a, b) => a + b.price, 0) / necks.length;
        const target = neck + (neck - h.price);
        const broke = lastClose > neck;
        out.push({ name: "Inverse Head and Shoulders", bias: "bullish", status: broke ? "completed" : "forming", confidence: broke ? 0.72 : 0.5, startTime: l.time, endTime: c[c.length - 1].time, keyLevel: neck, target, description: `Inverted head at ${fmt(h.price)} with shoulders near ${fmt(l.price)}/${fmt(r.price)}; neckline ≈ ${fmt(neck)}. ${broke ? "Neckline broken." : "Needs a close above the neckline to confirm."}` });
      }
    }
  }
  return out;
}

/* ---------- wedges, triangles, flags, pennants ---------- */

function wedgesTrianglesFlags(p: Pivot[], c: Candle[], lastClose: number): Pattern[] {
  const out: Pattern[] = [];
  const highs = p.filter((x) => x.kind === "high").slice(-4);
  const lows = p.filter((x) => x.kind === "low").slice(-4);
  if (highs.length < 3 || lows.length < 3) return out;
  const hs = slopeOf(highs); // per-bar slope normalized by price
  const ls = slopeOf(lows);
  const start = Math.min(highs[0].time, lows[0].time);
  const end = c[c.length - 1].time;
  const upperNow = highs[highs.length - 1].price;
  const lowerNow = lows[lows.length - 1].price;
  const flat = 0.0006; // ~0.06% per bar considered flat

  // prior move (for flags/pennants): the 20 bars before the structure began
  const startIdx = Math.min(highs[0].index, lows[0].index);
  const pre = c.slice(Math.max(0, startIdx - 25), startIdx);
  const preMove = pre.length > 5 ? (pre[pre.length - 1].close - pre[0].close) / pre[0].close : 0;
  const strongUp = preMove > 0.08;
  const strongDown = preMove < -0.08;
  const converging = hs < ls - flat; // upper falling relative to lower rising
  const broke = { up: lastClose > upperNow, down: lastClose < lowerNow };

  if (Math.abs(hs) <= flat && ls > flat) {
    out.push(mk("Ascending Triangle", "bullish", broke.up, 0.62, start, end, upperNow, `Flat resistance near ${fmt(upperNow)} with rising lows — buyers stepping in earlier each dip.`, broke.up ? "Breakout above the flat top." : "Confirms on a close above the flat top."));
  } else if (Math.abs(ls) <= flat && hs < -flat) {
    out.push(mk("Descending Triangle", "bearish", broke.down, 0.62, start, end, lowerNow, `Flat support near ${fmt(lowerNow)} with falling highs — sellers pressing lower each bounce.`, broke.down ? "Breakdown below the flat base." : "Confirms on a close below the flat base."));
  } else if (converging && hs < -flat && ls < -flat) {
    // both falling, converging → falling wedge (bullish)
    out.push(mk("Falling Wedge", "bullish", broke.up, 0.58, start, end, upperNow, "Both highs and lows are falling but converging — selling momentum is fading.", broke.up ? "Broke above the upper wedge line." : "Confirms on a close above the upper wedge line."));
  } else if (converging && hs > flat && ls > flat) {
    out.push(mk("Rising Wedge", "bearish", broke.down, 0.58, start, end, lowerNow, "Both highs and lows are rising but converging — buying momentum is fading.", broke.down ? "Broke below the lower wedge line." : "Confirms on a close below the lower wedge line."));
  } else if (converging && strongUp) {
    out.push(mk("Bull Pennant", "bullish", broke.up, 0.55, start, end, upperNow, `Tight symmetrical consolidation after a ${(preMove * 100).toFixed(0)}% advance.`, broke.up ? "Pennant resolved upward." : "Confirms on a breakout above the pennant."));
  } else if (converging && strongDown) {
    out.push(mk("Bear Pennant", "bearish", broke.down, 0.55, start, end, lowerNow, `Tight symmetrical consolidation after a ${(preMove * 100).toFixed(0)}% decline.`, broke.down ? "Pennant resolved downward." : "Confirms on a breakdown below the pennant."));
  } else if (strongUp && hs < -flat && ls < -flat && Math.abs(hs - ls) < flat * 2) {
    out.push(mk("Bull Flag", "bullish", broke.up, 0.6, start, end, upperNow, `Parallel downward-drifting channel after a ${(preMove * 100).toFixed(0)}% pole.`, broke.up ? "Flag resolved upward." : "Confirms on a close above the flag's upper line."));
  } else if (strongDown && hs > flat && ls > flat && Math.abs(hs - ls) < flat * 2) {
    out.push(mk("Bear Flag", "bearish", broke.down, 0.6, start, end, lowerNow, `Parallel upward-drifting channel after a ${(preMove * 100).toFixed(0)}% drop.`, broke.down ? "Flag resolved downward." : "Confirms on a close below the flag's lower line."));
  }
  return out;
}

function mk(name: string, bias: Bias, broke: boolean, conf: number, s: number, e: number, key: number, desc: string, trig: string): Pattern {
  return { name, bias, status: broke ? "completed" : "forming", confidence: broke ? conf + 0.12 : conf, startTime: s, endTime: e, keyLevel: key, description: `${desc} ${trig}` };
}

function slopeOf(ps: Pivot[]): number {
  const a = ps[0];
  const b = ps[ps.length - 1];
  return (b.price - a.price) / Math.max(1, b.index - a.index) / a.price;
}

/* ---------- cup & handle (rough) ---------- */

function cupAndHandle(c: Candle[], p: Pivot[], lastClose: number): Pattern[] {
  if (c.length < 80) return [];
  const n = c.length;
  const win = c.slice(n - 80);
  const closes = win.map((x) => x.close);
  const leftRim = Math.max(...closes.slice(0, 15));
  const rightRim = Math.max(...closes.slice(50, 70));
  const bottom = Math.min(...closes.slice(15, 50));
  if (pctDiff(leftRim, rightRim) > 0.05) return [];
  const depth = (leftRim - bottom) / leftRim;
  if (depth < 0.1 || depth > 0.5) return [];
  // roundness: bottom should be in the middle third
  const bi = closes.indexOf(bottom);
  if (bi < 20 || bi > 45) return [];
  const handleLow = Math.min(...closes.slice(70));
  if ((rightRim - handleLow) / rightRim > depth * 0.6) return [];
  const rim = Math.max(leftRim, rightRim);
  const broke = lastClose > rim;
  return [{ name: "Cup and Handle", bias: "bullish", status: broke ? "completed" : "forming", confidence: broke ? 0.6 : 0.42, startTime: win[0].time, endTime: win[win.length - 1].time, keyLevel: rim, target: rim + (rim - bottom), description: `Rounded ${(depth * 100).toFixed(0)}% base with a shallow handle under ${fmt(rim)}. ${broke ? "Rim breakout in progress." : "Confirms on a close above the rim."}` }];
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}

export { normalizedSlope };
