// Chart pattern detection with drawable geometry.
//
// Every detector works on the candles of ONE timeframe (callers run it per timeframe), uses
// swing pivots from real OHLCV, and returns a Pattern with the exact candle coordinates of its
// boundaries so the chart can draw it on top of the price action.
//
// Status vocabulary (never present speculation as fact):
//   forming     structure present, trigger level not broken on a close
//   confirmed   trigger broken on a close and still holding
//   completed   confirmed AND the measured target has been reached
//   failed      trigger broke, then price closed back through it within 6 bars (failed breakout)
//   invalidated structure violated on the wrong side before any trigger
//
// Confidence is computed from measurable criteria (touch counts, symmetry, volume, line fit).

import type { Candle } from "@/lib/types";
import { findPivots, type Pivot } from "./levels";
import { normalizedSlope, rsi } from "./indicators";

export type PatternStatus = "forming" | "confirmed" | "completed" | "failed" | "invalidated";
export type Bias = "bullish" | "bearish";
export type PatternFamily = "reversal" | "continuation" | "candlestick" | "structure" | "divergence" | "harmonic";

export interface PatternLine {
  kind: "trendline" | "neckline" | "boundary" | "target" | "trigger" | "invalidation";
  from: { time: number; price: number };
  to: { time: number; price: number };
}
export interface PatternPoint {
  time: number;
  price: number;
  label: string;
  side: "above" | "below";
}
export interface Pattern {
  id: string;
  name: string;
  family: PatternFamily;
  bias: Bias;
  status: PatternStatus;
  confidence: number; // 0..1
  startTime: number;
  endTime: number;
  keyLevel?: number; // trigger (breakout/breakdown or neckline)
  target?: number;
  invalidation?: number;
  description: string;
  criteria: string[];
  lines: PatternLine[];
  points: PatternPoint[];
  arc?: { time: number; price: number }[];
}

const pctDiff = (a: number, b: number) => Math.abs(a - b) / ((a + b) / 2);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function detectPatterns(candles: Candle[]): Pattern[] {
  if (candles.length < 40) return [];
  const ctx: Ctx = { c: candles, p: findPivots(candles, 3, 3), pm: findPivots(candles, 5, 5), n: candles.length };
  const out: Pattern[] = [];
  for (const det of [candlestick, structure, doubleTripleTopBottom, headAndShoulders, trianglesWedgesFlagsChannels, rectangles, cupAndHandle, roundingBottom, divergence, harmonics]) {
    try {
      out.push(...det(ctx));
    } catch (e) {
      console.warn("pattern detector failed", det.name, (e as Error).message);
    }
  }
  const byName = new Map<string, Pattern>();
  for (const p of out) {
    const prev = byName.get(p.name);
    if (!prev || p.endTime > prev.endTime || (p.endTime === prev.endTime && p.confidence > prev.confidence)) byName.set(p.name, p);
  }
  return [...byName.values()].sort((a, b) => b.endTime - a.endTime || b.confidence - a.confidence).slice(0, 14);
}

interface Ctx { c: Candle[]; p: Pivot[]; pm: Pivot[]; n: number }

/* ---------- shared helpers ---------- */

function resolveStatus(c: Candle[], triggerIndex: number, level: number, dir: Bias, target?: number): { status: PatternStatus; breakIndex: number | null } {
  const n = c.length;
  const broke = (x: Candle) => (dir === "bullish" ? x.close > level : x.close < level);
  let breakIndex: number | null = null;
  for (let i = Math.max(triggerIndex, 0); i < n; i++) if (broke(c[i])) { breakIndex = i; break; }
  if (breakIndex == null) return { status: "forming", breakIndex: null };
  for (let i = breakIndex + 1; i < Math.min(n, breakIndex + 7); i++) if (!broke(c[i])) return { status: "failed", breakIndex };
  if (target != null && c.slice(breakIndex).some((x) => (dir === "bullish" ? x.high >= target : x.low <= target))) return { status: "completed", breakIndex };
  const holding = broke(c[n - 1]) || n - 1 - breakIndex <= 2;
  return { status: holding ? "confirmed" : "failed", breakIndex };
}

const line = (kind: PatternLine["kind"], a: { time: number; price: number }, b: { time: number; price: number }): PatternLine => ({ kind, from: { time: a.time, price: a.price }, to: { time: b.time, price: b.price } });
const pt = (p: Pivot, label: string): PatternPoint => ({ time: p.time, price: p.price, label, side: p.kind === "high" ? "above" : "below" });
function mk(partial: Omit<Pattern, "id" | "lines" | "points" | "criteria"> & Partial<Pick<Pattern, "lines" | "points" | "criteria">>): Pattern {
  return { id: `${partial.name}-${partial.startTime}`.replace(/\s+/g, "_").toLowerCase(), lines: [], points: [], criteria: [], ...partial };
}
const volBoost = (c: Candle[], i: number) => {
  const w = c.slice(Math.max(0, i - 20), i);
  const avg = w.reduce((s, x) => s + x.volume, 0) / Math.max(1, w.length);
  return avg > 0 ? c[i].volume / avg : 1;
};
const confirmedBonus = (s: PatternStatus) => (s === "confirmed" || s === "completed" ? 0.12 : 0);

/* ---------- candlestick patterns (last 6 bars) ---------- */

function candlestick(ctx: Ctx): Pattern[] {
  const { c, n } = ctx;
  const out: Pattern[] = [];
  const body = (x: Candle) => Math.abs(x.close - x.open);
  const range = (x: Candle) => x.high - x.low || 1e-9;
  const up = (x: Candle) => x.close > x.open;
  const trendBefore = (i: number, bars = 6) => (i - bars >= 0 ? (c[i - 1].close - c[i - bars].close) / c[i - bars].close : 0);
  const add = (name: string, bias: Bias, i0: number, i1: number, conf: number, desc: string, crit: string[]) => {
    const a = c[i0];
    const b = c[i1];
    out.push(mk({ name, family: "candlestick", bias, status: i1 >= n - 2 ? "confirmed" : "completed", confidence: r2(conf), startTime: a.time, endTime: b.time, description: desc, criteria: crit, lines: [line("boundary", { time: a.time, price: bias === "bullish" ? Math.min(a.low, b.low) : Math.max(a.high, b.high) }, { time: b.time, price: bias === "bullish" ? Math.min(a.low, b.low) : Math.max(a.high, b.high) })], points: [{ time: b.time, price: bias === "bullish" ? b.low : b.high, label: name.split(" ").map((w) => w[0]).join(""), side: bias === "bullish" ? "below" : "above" }] }));
  };
  for (let i = Math.max(3, n - 6); i < n; i++) {
    const a = c[i - 1];
    const b = c[i];
    const vb = volBoost(c, i);
    if (body(b) > body(a) * 1.2) {
      if (!up(a) && up(b) && b.close > a.open && b.open < a.close && trendBefore(i) < 0) add("Bullish Engulfing", "bullish", i - 1, i, Math.min(0.8, 0.5 + 0.1 * Math.min(2, vb)), "A large green body fully engulfed the prior red body after a decline.", [`body ratio ${(body(b) / body(a)).toFixed(1)}x`, `volume ${vb.toFixed(1)}x avg`]);
      if (up(a) && !up(b) && b.close < a.open && b.open > a.close && trendBefore(i) > 0) add("Bearish Engulfing", "bearish", i - 1, i, Math.min(0.8, 0.5 + 0.1 * Math.min(2, vb)), "A large red body fully engulfed the prior green body after an advance.", [`body ratio ${(body(b) / body(a)).toFixed(1)}x`, `volume ${vb.toFixed(1)}x avg`]);
    }
    if (body(a) > range(a) * 0.5 && body(b) < body(a) * 0.5 && Math.max(b.open, b.close) < Math.max(a.open, a.close) && Math.min(b.open, b.close) > Math.min(a.open, a.close)) {
      if (!up(a) && trendBefore(i) < 0) add("Bullish Harami", "bullish", i - 1, i, 0.45, "A small body held inside the prior large red candle: selling pressure pausing.", ["inside bar after decline"]);
      if (up(a) && trendBefore(i) > 0) add("Bearish Harami", "bearish", i - 1, i, 0.45, "A small body held inside the prior large green candle: buying pressure pausing.", ["inside bar after advance"]);
    }
    const x = c[i - 2];
    if (body(x) > range(x) * 0.5 && body(a) < range(a) * 0.3) {
      if (!up(x) && up(b) && b.close > (x.open + x.close) / 2 && trendBefore(i - 2) < 0) add("Morning Star", "bullish", i - 2, i, 0.6, "Large red candle, small indecision candle, then a green candle closing into the first body.", ["3-bar reversal", `volume ${vb.toFixed(1)}x avg`]);
      if (up(x) && !up(b) && b.close < (x.open + x.close) / 2 && trendBefore(i - 2) > 0) add("Evening Star", "bearish", i - 2, i, 0.6, "Large green candle, small indecision candle, then a red candle closing into the first body.", ["3-bar reversal", `volume ${vb.toFixed(1)}x avg`]);
    }
    const s3 = [c[i - 2], c[i - 1], c[i]];
    if (s3.every(up) && s3.every((k) => body(k) > range(k) * 0.55) && c[i].close > c[i - 1].close && c[i - 1].close > c[i - 2].close && c[i].open > c[i - 1].open && c[i - 1].open > c[i - 2].open) add("Three White Soldiers", "bullish", i - 2, i, 0.62, "Three consecutive strong green candles with rising opens and closes.", ["3 full-bodied green bars"]);
    if (s3.every((k) => !up(k)) && s3.every((k) => body(k) > range(k) * 0.55) && c[i].close < c[i - 1].close && c[i - 1].close < c[i - 2].close && c[i].open < c[i - 1].open && c[i - 1].open < c[i - 2].open) add("Three Black Crows", "bearish", i - 2, i, 0.62, "Three consecutive strong red candles with falling opens and closes.", ["3 full-bodied red bars"]);
    const lowerWick = Math.min(b.open, b.close) - b.low;
    const upperWick = b.high - Math.max(b.open, b.close);
    if (lowerWick > body(b) * 2 && upperWick < body(b) && trendBefore(i) < -0.02) add("Hammer", "bullish", i, i, 0.4, "Long lower wick after a decline: buyers rejected lower prices.", [`lower wick ${(lowerWick / Math.max(body(b), 1e-9)).toFixed(1)}x body`]);
    if (upperWick > body(b) * 2 && lowerWick < body(b) && trendBefore(i) > 0.02) add("Shooting Star", "bearish", i, i, 0.4, "Long upper wick after an advance: sellers rejected higher prices.", [`upper wick ${(upperWick / Math.max(body(b), 1e-9)).toFixed(1)}x body`]);
  }
  return out;
}

/* ---------- market structure ---------- */

function structure(ctx: Ctx): Pattern[] {
  const { p, c, n } = ctx;
  const highs = p.filter((x) => x.kind === "high").slice(-3);
  const lows = p.filter((x) => x.kind === "low").slice(-3);
  if (highs.length < 3 || lows.length < 3) return [];
  const hh = highs[2].price > highs[1].price && highs[1].price > highs[0].price;
  const hl = lows[2].price > lows[1].price && lows[1].price > lows[0].price;
  const lh = highs[2].price < highs[1].price && highs[1].price < highs[0].price;
  const ll = lows[2].price < lows[1].price && lows[1].price < lows[0].price;
  const start = Math.min(highs[0].time, lows[0].time);
  const end = c[n - 1].time;
  const lines: PatternLine[] = [line("trendline", highs[0], highs[2]), line("trendline", lows[0], lows[2])];
  const points = [...highs.map((h, i) => pt(h, i === 0 ? "H" : hh ? "HH" : lh ? "LH" : "H")), ...lows.map((l, i) => pt(l, i === 0 ? "L" : hl ? "HL" : ll ? "LL" : "L"))];
  if (hh && hl) return [mk({ name: "Higher Highs & Higher Lows", family: "structure", bias: "bullish", status: c[n - 1].close > lows[2].price ? "confirmed" : "invalidated", confidence: 0.7, startTime: start, endTime: end, invalidation: lows[2].price, description: "Three consecutive higher swing highs and higher swing lows: uptrend structure. Invalidated by a close below the last higher low.", criteria: ["3 HH", "3 HL"], lines, points })];
  if (lh && ll) return [mk({ name: "Lower Highs & Lower Lows", family: "structure", bias: "bearish", status: c[n - 1].close < highs[2].price ? "confirmed" : "invalidated", confidence: 0.7, startTime: start, endTime: end, invalidation: highs[2].price, description: "Three consecutive lower swing highs and lower swing lows: downtrend structure. Invalidated by a close above the last lower high.", criteria: ["3 LH", "3 LL"], lines, points })];
  if (hl && !lh) return [mk({ name: "Higher Lows", family: "structure", bias: "bullish", status: "forming", confidence: 0.4, startTime: start, endTime: end, keyLevel: highs[2].price, description: "Lows are rising while highs have not confirmed yet. Confirms on a close above the last swing high.", criteria: ["3 HL", "highs flat/mixed"], lines: [lines[1], line("trigger", { time: highs[2].time, price: highs[2].price }, { time: end, price: highs[2].price })], points })];
  if (lh && !hl) return [mk({ name: "Lower Highs", family: "structure", bias: "bearish", status: "forming", confidence: 0.4, startTime: start, endTime: end, keyLevel: lows[2].price, description: "Highs are falling while lows have not broken down yet. Confirms on a close below the last swing low.", criteria: ["3 LH", "lows flat/mixed"], lines: [lines[0], line("trigger", { time: lows[2].time, price: lows[2].price }, { time: end, price: lows[2].price })], points })];
  return [];
}

/* ---------- double / triple tops & bottoms ---------- */

function doubleTripleTopBottom(ctx: Ctx): Pattern[] {
  const { pm: p, c, n } = ctx;
  const out: Pattern[] = [];
  const highs = p.filter((x) => x.kind === "high").slice(-6);
  const lows = p.filter((x) => x.kind === "low").slice(-6);
  const end = c[n - 1].time;
  const tol = 0.02;
  const run = (peaks: Pivot[], troughs: Pivot[], bias: Bias) => {
    for (let count = 3; count >= 2; count--) {
      for (let i = 0; i + count - 1 < peaks.length; i++) {
        const set = peaks.slice(i, i + count);
        if (!set.every((x) => pctDiff(x.price, set[0].price) <= tol)) continue;
        if (set[set.length - 1].index - set[0].index < 8) continue;
        const between = troughs.filter((t) => t.index > set[0].index && t.index < set[set.length - 1].index);
        if (between.length < count - 1) continue;
        const neck = bias === "bearish" ? Math.min(...between.map((t) => t.price)) : Math.max(...between.map((t) => t.price));
        const extreme = bias === "bearish" ? Math.max(...set.map((x) => x.price)) : Math.min(...set.map((x) => x.price));
        const depth = Math.abs(extreme - neck) / extreme;
        if (depth < 0.02) continue;
        const target = bias === "bearish" ? neck - (extreme - neck) : neck + (neck - extreme);
        const { status } = resolveStatus(c, set[set.length - 1].index, neck, bias, target);
        const name = `${count === 3 ? "Triple" : "Double"} ${bias === "bearish" ? "Top" : "Bottom"}`;
        const sym = 1 - Math.max(...set.map((x) => pctDiff(x.price, set[0].price))) / tol;
        out.push(mk({
          name, family: "reversal", bias, status, confidence: r2(Math.min(0.9, 0.45 + 0.15 * sym + (count === 3 ? 0.1 : 0) + confirmedBonus(status))), startTime: set[0].time, endTime: end, keyLevel: neck, target, invalidation: extreme,
          description: `${count} swing ${bias === "bearish" ? "highs" : "lows"} within ${(tol * 100).toFixed(0)}% near ${fmt(extreme)}; neckline ${fmt(neck)}, measured target ${fmt(target)}. ${statusText(status, bias, neck)}`,
          criteria: [`${count} touches within ${(tol * 100).toFixed(0)}%`, `depth ${(depth * 100).toFixed(1)}%`, `symmetry ${(sym * 100).toFixed(0)}%`],
          lines: [line("neckline", { time: set[0].time, price: neck }, { time: end, price: neck }), line("boundary", set[0], set[set.length - 1]), line("target", { time: end, price: neck }, { time: end, price: target })],
          points: set.map((x, k) => pt(x, String(k + 1))),
        }));
        return;
      }
    }
  };
  run(highs, lows, "bearish");
  run(lows, highs, "bullish");
  return out;
}

/* ---------- head & shoulders ---------- */

function headAndShoulders(ctx: Ctx): Pattern[] {
  const { pm: p, c, n } = ctx;
  const out: Pattern[] = [];
  const end = c[n - 1].time;
  const run = (peaks: Pivot[], troughs: Pivot[], inverse: boolean) => {
    const bias: Bias = inverse ? "bullish" : "bearish";
    for (let i = peaks.length - 3; i >= 0; i--) {
      const [l, h, r] = [peaks[i], peaks[i + 1], peaks[i + 2]];
      const headOk = inverse ? h.price < l.price * 0.98 && h.price < r.price * 0.98 : h.price > l.price * 1.02 && h.price > r.price * 1.02;
      if (!headOk || pctDiff(l.price, r.price) > 0.05) continue;
      const necks = troughs.filter((x) => x.index > l.index && x.index < r.index);
      if (necks.length < 2) continue;
      const n1 = necks[0];
      const n2 = necks[necks.length - 1];
      const slope = (n2.price - n1.price) / Math.max(1, n2.index - n1.index);
      const neckAt = (idx: number) => n1.price + slope * (idx - n1.index);
      const neckNow = neckAt(n - 1);
      const target = inverse ? neckNow + (neckNow - h.price) : neckNow - (h.price - neckNow);
      let status: PatternStatus = "forming";
      let breakIdx: number | null = null;
      for (let k = r.index; k < n; k++) if (inverse ? c[k].close > neckAt(k) : c[k].close < neckAt(k)) { breakIdx = k; break; }
      if (breakIdx != null) {
        status = "confirmed";
        for (let k = breakIdx + 1; k < Math.min(n, breakIdx + 7); k++) if (inverse ? c[k].close < neckAt(k) : c[k].close > neckAt(k)) { status = "failed"; break; }
        if (status === "confirmed" && c.slice(breakIdx).some((x) => (inverse ? x.high >= target : x.low <= target))) status = "completed";
      } else if (inverse ? c[n - 1].close < h.price : c[n - 1].close > h.price) status = "invalidated";
      const sym = 1 - pctDiff(l.price, r.price) / 0.05;
      out.push(mk({
        name: inverse ? "Inverse Head and Shoulders" : "Head and Shoulders", family: "reversal", bias, status, confidence: r2(Math.min(0.9, 0.45 + 0.2 * sym + confirmedBonus(status))), startTime: l.time, endTime: end, keyLevel: neckNow, target, invalidation: h.price,
        description: `${inverse ? "Inverted head" : "Head"} at ${fmt(h.price)} between shoulders ${fmt(l.price)} / ${fmt(r.price)}; neckline now ${fmt(neckNow)}, target ${fmt(target)}. ${statusText(status, bias, neckNow)}`,
        criteria: [`shoulder symmetry ${(sym * 100).toFixed(0)}%`, `head prominence ${((Math.abs(h.price - (l.price + r.price) / 2) / h.price) * 100).toFixed(1)}%`, `neckline slope ${((slope / n1.price) * 100).toFixed(3)}%/bar`],
        lines: [line("neckline", { time: n1.time, price: n1.price }, { time: end, price: neckNow }), line("boundary", l, h), line("boundary", h, r), line("target", { time: end, price: neckNow }, { time: end, price: target })],
        points: [pt(l, "LS"), pt(h, "H"), pt(r, "RS")],
      }));
      return;
    }
  };
  run(p.filter((x) => x.kind === "high").slice(-6), p.filter((x) => x.kind === "low").slice(-8), false);
  run(p.filter((x) => x.kind === "low").slice(-6), p.filter((x) => x.kind === "high").slice(-8), true);
  return out;
}

/* ---------- triangles, wedges, flags, pennants, channels ---------- */

function fitLine(ps: Pivot[]) {
  const xs = ps.map((p) => p.index);
  const ys = ps.map((p) => p.price);
  const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
  const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = ym - slope * xm;
  const ssRes = ys.reduce((s, y, i) => s + (y - (intercept + slope * xs[i])) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - ym) ** 2, 0) || 1e-9;
  return { slope, intercept, r2: Math.max(0, 1 - ssRes / ssTot) };
}

function trianglesWedgesFlagsChannels(ctx: Ctx): Pattern[] {
  const { p, c, n } = ctx;
  const out: Pattern[] = [];
  const hi = p.filter((x) => x.kind === "high").slice(-4);
  const lo = p.filter((x) => x.kind === "low").slice(-4);
  if (hi.length < 3 || lo.length < 3) return out;
  const fh = fitLine(hi);
  const fl = fitLine(lo);
  const price = c[n - 1].close;
  const hs = fh.slope / price;
  const ls = fl.slope / price;
  const flat = 0.0006;
  const startIdx = Math.min(hi[0].index, lo[0].index);
  const startTime = c[startIdx].time;
  const end = c[n - 1].time;
  const upperNow = fh.intercept + fh.slope * (n - 1);
  const lowerNow = fl.intercept + fl.slope * (n - 1);
  const upperStart = fh.intercept + fh.slope * startIdx;
  const lowerStart = fl.intercept + fl.slope * startIdx;
  const widthStart = upperStart - lowerStart;
  const widthNow = upperNow - lowerNow;
  if (widthStart <= 0) return out;
  const converging = widthNow < widthStart * 0.75;
  const parallel = Math.abs(hs - ls) < flat * 1.5 && !converging;
  const pre = c.slice(Math.max(0, startIdx - 25), startIdx);
  const preMove = pre.length > 5 ? (pre[pre.length - 1].close - pre[0].close) / pre[0].close : 0;
  const strongUp = preMove > 0.08;
  const strongDown = preMove < -0.08;
  const fit = Math.min(fh.r2, fl.r2);
  const touches = hi.length + lo.length;
  const base = Math.min(0.85, 0.35 + 0.25 * fit + 0.03 * touches);
  const lines: PatternLine[] = [line("trendline", { time: c[startIdx].time, price: upperStart }, { time: end, price: upperNow }), line("trendline", { time: c[startIdx].time, price: lowerStart }, { time: end, price: lowerNow })];
  const points = [...hi.map((h) => pt(h, "")), ...lo.map((l) => pt(l, ""))];
  const heightStart = Math.abs(widthStart);
  const pole = Math.abs(preMove) * price;
  const emit = (name: string, bias: Bias, family: PatternFamily, triggerLevel: number, target: number, desc: string, extra: string[]) => {
    const { status } = resolveStatus(c, Math.max(hi[hi.length - 1].index, lo[lo.length - 1].index), triggerLevel, bias, target);
    out.push(mk({ name, family, bias, status, confidence: r2(Math.min(0.92, base + confirmedBonus(status))), startTime, endTime: end, keyLevel: triggerLevel, target, invalidation: bias === "bullish" ? lowerNow : upperNow, description: `${desc} ${statusText(status, bias, triggerLevel)}`, criteria: [`line fit R2 ${fit.toFixed(2)}`, `${touches} touches`, ...extra], lines: [...lines, line("target", { time: end, price: triggerLevel }, { time: end, price: target })], points }));
  };
  const channel = (name: string, bias: Bias) => {
    const breakLevel = bias === "bullish" ? lowerNow : upperNow;
    const inside = bias === "bullish" ? c[n - 1].close >= lowerNow : c[n - 1].close <= upperNow;
    out.push(mk({ name, family: "continuation", bias, status: inside ? "confirmed" : "invalidated", confidence: r2(base), startTime, endTime: end, keyLevel: breakLevel, target: bias === "bullish" ? upperNow : lowerNow, invalidation: breakLevel, description: `${name} between ${fmt(lowerNow)} and ${fmt(upperNow)}. ${bias === "bullish" ? "Bullish" : "Bearish"} while price stays inside; a close ${bias === "bullish" ? "below" : "above"} ${fmt(breakLevel)} breaks the channel.`, criteria: [`line fit R2 ${fit.toFixed(2)}`, `${touches} touches`, "parallel boundaries"], lines, points }));
  };

  if (Math.abs(hs) <= flat && ls > flat && converging) emit("Ascending Triangle", "bullish", "continuation", upperNow, upperNow + heightStart, `Flat resistance near ${fmt(upperNow)} with rising lows.`, ["upper line flat", `lower slope +${(ls * 100).toFixed(3)}%/bar`]);
  else if (Math.abs(ls) <= flat && hs < -flat && converging) emit("Descending Triangle", "bearish", "continuation", lowerNow, lowerNow - heightStart, `Flat support near ${fmt(lowerNow)} with falling highs.`, ["lower line flat", `upper slope ${(hs * 100).toFixed(3)}%/bar`]);
  else if (converging && hs < -flat && ls > flat) {
    if (strongUp) emit("Bull Pennant", "bullish", "continuation", upperNow, upperNow + pole, `Tight symmetrical consolidation after a ${(preMove * 100).toFixed(0)}% advance (pole).`, [`pole ${(preMove * 100).toFixed(0)}%`]);
    else if (strongDown) emit("Bear Pennant", "bearish", "continuation", lowerNow, lowerNow - pole, `Tight symmetrical consolidation after a ${(preMove * 100).toFixed(0)}% decline (pole).`, [`pole ${(preMove * 100).toFixed(0)}%`]);
    else {
      const bias: Bias = preMove >= 0 ? "bullish" : "bearish";
      emit("Symmetrical Triangle", bias, "continuation", bias === "bullish" ? upperNow : lowerNow, bias === "bullish" ? upperNow + heightStart : lowerNow - heightStart, "Converging highs and lows with no slope bias; breaks usually follow the prior trend.", ["converging both sides"]);
    }
  } else if (converging && hs < -flat && ls < -flat) emit("Falling Wedge", "bullish", "reversal", upperNow, upperNow + heightStart, "Both boundaries fall and converge: selling momentum fading.", ["both slopes negative", "converging"]);
  else if (converging && hs > flat && ls > flat) emit("Rising Wedge", "bearish", "reversal", lowerNow, lowerNow - heightStart, "Both boundaries rise and converge: buying momentum fading.", ["both slopes positive", "converging"]);
  else if (parallel && strongUp && hs < -flat) emit("Bull Flag", "bullish", "continuation", upperNow, upperNow + pole, `Parallel downward-drifting channel after a ${(preMove * 100).toFixed(0)}% pole.`, [`pole ${(preMove * 100).toFixed(0)}%`, "parallel boundaries"]);
  else if (parallel && strongDown && hs > flat) emit("Bear Flag", "bearish", "continuation", lowerNow, lowerNow - pole, `Parallel upward-drifting channel after a ${(preMove * 100).toFixed(0)}% drop.`, [`pole ${(preMove * 100).toFixed(0)}%`, "parallel boundaries"]);
  else if (parallel && hs > flat && ls > flat) channel("Rising Channel", "bullish");
  else if (parallel && hs < -flat && ls < -flat) channel("Falling Channel", "bearish");
  return out;
}

/* ---------- rectangles (ranges) ---------- */

function rectangles(ctx: Ctx): Pattern[] {
  const { p, c, n } = ctx;
  const highs = p.filter((x) => x.kind === "high").slice(-4);
  const lows = p.filter((x) => x.kind === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return [];
  const top = highs.reduce((s, x) => s + x.price, 0) / highs.length;
  const bot = lows.reduce((s, x) => s + x.price, 0) / lows.length;
  if (!highs.every((x) => pctDiff(x.price, top) < 0.015) || !lows.every((x) => pctDiff(x.price, bot) < 0.015)) return [];
  const height = top - bot;
  if (height / top < 0.02) return [];
  const startIdx = Math.min(highs[0].index, lows[0].index);
  if (n - 1 - startIdx < 10) return [];
  const pre = c.slice(Math.max(0, startIdx - 25), startIdx);
  const preMove = pre.length > 5 ? (pre[pre.length - 1].close - pre[0].close) / pre[0].close : 0;
  const bias: Bias = preMove >= 0 ? "bullish" : "bearish";
  const trigger = bias === "bullish" ? top : bot;
  const target = bias === "bullish" ? top + height : bot - height;
  const { status } = resolveStatus(c, Math.max(highs[highs.length - 1].index, lows[lows.length - 1].index), trigger, bias, target);
  const end = c[n - 1].time;
  return [mk({
    name: bias === "bullish" ? "Bullish Rectangle" : "Bearish Rectangle", family: "continuation", bias, status, confidence: r2(Math.min(0.85, 0.4 + 0.05 * (highs.length + lows.length) + confirmedBonus(status))), startTime: c[startIdx].time, endTime: end, keyLevel: trigger, target, invalidation: bias === "bullish" ? bot : top,
    description: `Range between ${fmt(bot)} and ${fmt(top)} (${((height / top) * 100).toFixed(1)}% tall) after a ${preMove >= 0 ? "rise" : "drop"}; expected to continue ${bias === "bullish" ? "up" : "down"}. ${statusText(status, bias, trigger)}`,
    criteria: [`${highs.length} top touches`, `${lows.length} bottom touches`, `prior move ${(preMove * 100).toFixed(0)}%`],
    lines: [line("boundary", { time: c[startIdx].time, price: top }, { time: end, price: top }), line("boundary", { time: c[startIdx].time, price: bot }, { time: end, price: bot }), line("target", { time: end, price: trigger }, { time: end, price: target })],
  })];
}

/* ---------- cup & handle / rounding bottom ---------- */

function cupAndHandle(ctx: Ctx): Pattern[] {
  const { c, n } = ctx;
  if (n < 80) return [];
  const win = c.slice(n - 80);
  const off = n - 80;
  const closes = win.map((x) => x.close);
  const leftIdx = argmax(closes.slice(0, 15));
  const rightIdx = 50 + argmax(closes.slice(50, 70));
  const leftRim = closes[leftIdx];
  const rightRim = closes[rightIdx];
  const botIdx = 15 + argmin(closes.slice(15, 50));
  const bottom = closes[botIdx];
  if (pctDiff(leftRim, rightRim) > 0.05) return [];
  const depth = (leftRim - bottom) / leftRim;
  if (depth < 0.1 || depth > 0.5 || botIdx < 20 || botIdx > 45) return [];
  const handleLow = Math.min(...closes.slice(70));
  if ((rightRim - handleLow) / rightRim > depth * 0.6) return [];
  const rim = Math.max(leftRim, rightRim);
  const target = rim + (rim - bottom);
  const { status } = resolveStatus(c, off + 70, rim, "bullish", target);
  const arc = win.slice(leftIdx, rightIdx + 1).filter((_, i) => i % 2 === 0).map((x) => ({ time: x.time, price: x.low }));
  const roundness = 1 - Math.abs(botIdx - (leftIdx + rightIdx) / 2) / ((rightIdx - leftIdx) / 2);
  return [mk({
    name: "Cup and Handle", family: "continuation", bias: "bullish", status, confidence: r2(Math.min(0.85, 0.35 + 0.25 * roundness + confirmedBonus(status))), startTime: win[leftIdx].time, endTime: win[win.length - 1].time, keyLevel: rim, target, invalidation: handleLow,
    description: `Rounded ${(depth * 100).toFixed(0)}% base with a shallow handle under the rim at ${fmt(rim)}; target ${fmt(target)}. ${statusText(status, "bullish", rim)}`,
    criteria: [`depth ${(depth * 100).toFixed(0)}%`, `roundness ${(roundness * 100).toFixed(0)}%`, `handle depth ${(((rightRim - handleLow) / rightRim) * 100).toFixed(1)}%`],
    lines: [line("trigger", { time: win[leftIdx].time, price: rim }, { time: win[win.length - 1].time, price: rim }), line("target", { time: win[win.length - 1].time, price: rim }, { time: win[win.length - 1].time, price: target })],
    points: [{ time: win[botIdx].time, price: bottom, label: "cup", side: "below" }],
    arc,
  })];
}

function roundingBottom(ctx: Ctx): Pattern[] {
  const { c, n } = ctx;
  if (n < 60) return [];
  const win = c.slice(n - 60);
  const closes = win.map((x) => x.close);
  const xs = closes.map((_, i) => i);
  const { a, b, d, r2: fitR2 } = quadFit(xs, closes);
  if (!(a > 0) || fitR2 < 0.6) return [];
  const vx = -b / (2 * a);
  if (vx < 15 || vx > 45) return [];
  const rim = Math.max(...closes.slice(0, 10));
  const bottom = a * vx * vx + b * vx + d;
  if ((rim - bottom) / rim < 0.08) return [];
  const target = rim + (rim - bottom);
  const { status } = resolveStatus(c, n - 10, rim, "bullish", target);
  const arc = xs.filter((_, i) => i % 2 === 0).map((x) => ({ time: win[x].time, price: a * x * x + b * x + d }));
  return [mk({
    name: "Rounding Bottom", family: "reversal", bias: "bullish", status, confidence: r2(Math.min(0.8, 0.3 + 0.4 * fitR2 + confirmedBonus(status))), startTime: win[0].time, endTime: win[win.length - 1].time, keyLevel: rim, target, invalidation: bottom,
    description: `Saucer-shaped base (curve fit R2 ${fitR2.toFixed(2)}) bottoming near ${fmt(bottom)} with the rim at ${fmt(rim)}; target ${fmt(target)}. ${statusText(status, "bullish", rim)}`,
    criteria: [`curve fit R2 ${fitR2.toFixed(2)}`, `depth ${(((rim - bottom) / rim) * 100).toFixed(0)}%`],
    lines: [line("trigger", { time: win[0].time, price: rim }, { time: win[win.length - 1].time, price: rim }), line("target", { time: win[win.length - 1].time, price: rim }, { time: win[win.length - 1].time, price: target })],
    arc,
  })];
}

/* ---------- RSI divergence ---------- */

function divergence(ctx: Ctx): Pattern[] {
  const { c, n, p } = ctx;
  const out: Pattern[] = [];
  const r = rsi(c.map((x) => x.close), 14);
  const highs = p.filter((x) => x.kind === "high").slice(-2);
  const lows = p.filter((x) => x.kind === "low").slice(-2);
  const end = c[n - 1].time;
  if (lows.length === 2 && lows[1].index >= n - 25 && lows[1].price < lows[0].price && r[lows[1].index] > r[lows[0].index] + 3 && r[lows[1].index] < 45) {
    const gap = r[lows[1].index] - r[lows[0].index];
    const trig = highs[highs.length - 1]?.price;
    out.push(mk({ name: "Bullish Divergence", family: "divergence", bias: "bullish", status: c[n - 1].close > lows[1].price ? (trig && c[n - 1].close > trig ? "confirmed" : "forming") : "invalidated", confidence: r2(Math.min(0.75, 0.4 + gap / 40)), startTime: lows[0].time, endTime: end, keyLevel: trig, invalidation: lows[1].price, description: `Price made a lower low (${fmt(lows[0].price)} to ${fmt(lows[1].price)}) while RSI made a higher low (${r[lows[0].index].toFixed(0)} to ${r[lows[1].index].toFixed(0)}): selling momentum is fading. Confirms on a close above the last swing high.`, criteria: [`RSI gap +${gap.toFixed(1)}`, "price lower low"], lines: [line("trendline", lows[0], lows[1]), ...(trig ? [line("trigger", { time: lows[1].time, price: trig }, { time: end, price: trig })] : [])], points: [pt(lows[0], `RSI ${r[lows[0].index].toFixed(0)}`), pt(lows[1], `RSI ${r[lows[1].index].toFixed(0)}`)] }));
  }
  if (highs.length === 2 && highs[1].index >= n - 25 && highs[1].price > highs[0].price && r[highs[1].index] < r[highs[0].index] - 3 && r[highs[1].index] > 55) {
    const gap = r[highs[0].index] - r[highs[1].index];
    const trig = lows[lows.length - 1]?.price;
    out.push(mk({ name: "Bearish Divergence", family: "divergence", bias: "bearish", status: c[n - 1].close < highs[1].price ? (trig && c[n - 1].close < trig ? "confirmed" : "forming") : "invalidated", confidence: r2(Math.min(0.75, 0.4 + gap / 40)), startTime: highs[0].time, endTime: end, keyLevel: trig, invalidation: highs[1].price, description: `Price made a higher high (${fmt(highs[0].price)} to ${fmt(highs[1].price)}) while RSI made a lower high (${r[highs[0].index].toFixed(0)} to ${r[highs[1].index].toFixed(0)}): buying momentum is fading. Confirms on a close below the last swing low.`, criteria: [`RSI gap -${gap.toFixed(1)}`, "price higher high"], lines: [line("trendline", highs[0], highs[1]), ...(trig ? [line("trigger", { time: highs[1].time, price: trig }, { time: end, price: trig })] : [])], points: [pt(highs[0], `RSI ${r[highs[0].index].toFixed(0)}`), pt(highs[1], `RSI ${r[highs[1].index].toFixed(0)}`)] }));
  }
  return out;
}

/* ---------- harmonic patterns (XABCD) ---------- */

const HARMONICS: { name: string; ab: [number, number]; bc: [number, number]; d: [number, number] }[] = [
  { name: "Gartley", ab: [0.58, 0.66], bc: [0.382, 0.886], d: [0.75, 0.82] },
  { name: "Bat", ab: [0.382, 0.5], bc: [0.382, 0.886], d: [0.85, 0.92] },
  { name: "Butterfly", ab: [0.76, 0.82], bc: [0.382, 0.886], d: [1.27, 1.618] },
  { name: "Crab", ab: [0.382, 0.618], bc: [0.382, 0.886], d: [1.55, 1.65] },
];

function harmonics(ctx: Ctx): Pattern[] {
  const { pm, c, n } = ctx;
  const out: Pattern[] = [];
  const ps = pm.slice(-5);
  if (ps.length < 5) return out;
  for (let i = 1; i < ps.length; i++) if (ps[i].kind === ps[i - 1].kind) return out;
  const [X, A, B, C, D] = ps;
  const xa = Math.abs(A.price - X.price);
  const ab = Math.abs(B.price - A.price);
  const bc = Math.abs(C.price - B.price);
  const xd = Math.abs(D.price - X.price);
  if (!xa || !ab || !bc) return out;
  const abR = ab / xa, bcR = bc / ab, dR = xd / xa;
  const bullish = X.kind === "low";
  const inRange = (v: number, [lo, hi]: [number, number], tol = 0.06) => v >= lo - tol && v <= hi + tol;
  for (const h of HARMONICS) {
    if (!inRange(abR, h.ab) || !inRange(bcR, h.bc) || !inRange(dR, h.d)) continue;
    const err = Math.abs(abR - (h.ab[0] + h.ab[1]) / 2) + Math.abs(bcR - (h.bc[0] + h.bc[1]) / 2) + Math.abs(dR - (h.d[0] + h.d[1]) / 2);
    const bias: Bias = bullish ? "bullish" : "bearish";
    const target = bullish ? D.price + (C.price - D.price) * 0.618 : D.price - (D.price - C.price) * 0.618;
    const status: PatternStatus = D.index >= n - 8 ? "forming" : (bullish ? c[n - 1].close > D.price : c[n - 1].close < D.price) ? "confirmed" : "failed";
    out.push(mk({ name: `${bullish ? "Bullish" : "Bearish"} ${h.name}`, family: "harmonic", bias, status, confidence: r2(Math.max(0.3, 0.75 - err)), startTime: X.time, endTime: c[n - 1].time, keyLevel: D.price, target, invalidation: bullish ? D.price * 0.97 : D.price * 1.03, description: `XABCD ratios AB/XA ${abR.toFixed(2)}, BC/AB ${bcR.toFixed(2)}, XD/XA ${dR.toFixed(2)} match the ${h.name}. Potential reversal zone at D (${fmt(D.price)}), first target ${fmt(target)} (61.8% of CD).`, criteria: [`ratio error ${err.toFixed(2)}`, "5 alternating pivots"], lines: [line("boundary", X, A), line("boundary", A, B), line("boundary", B, C), line("boundary", C, D), line("boundary", X, B), line("boundary", B, D), line("target", D, { time: c[n - 1].time, price: target })], points: [pt(X, "X"), pt(A, "A"), pt(B, "B"), pt(C, "C"), pt(D, "D")] }));
    break;
  }
  return out;
}

/* ---------- utils ---------- */

function statusText(status: PatternStatus, bias: Bias, level: number) {
  const dir = bias === "bullish" ? "above" : "below";
  switch (status) {
    case "forming": return `Forming: not confirmed until a candle closes ${dir} ${fmt(level)}.`;
    case "confirmed": return `Confirmed: closed ${dir} ${fmt(level)} and holding.`;
    case "completed": return "Completed: the trigger broke and the measured target was reached.";
    case "failed": return `Failed breakout: closed ${dir} ${fmt(level)} but fell back within 6 bars.`;
    case "invalidated": return "Invalidated: price violated the pattern before the trigger.";
  }
}
function argmax(a: number[]) { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; }
function argmin(a: number[]) { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[m]) m = i; return m; }
function quadFit(xs: number[], ys: number[]) {
  const n = xs.length;
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i]; sx += x; sx2 += x * x; sx3 += x ** 3; sx4 += x ** 4; sy += y; sxy += x * y; sx2y += x * x * y; }
  const M = [[sx4, sx3, sx2], [sx3, sx2, sx], [sx2, sx, n]];
  const V = [sx2y, sxy, sy];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (!D) return { a: 0, b: 0, d: 0, r2: 0 };
  const col = (k: number) => M.map((row, i) => row.map((v, j) => (j === k ? V[i] : v)));
  const a = det(col(0)) / D, b = det(col(1)) / D, d = det(col(2)) / D;
  const ym = sy / n;
  const ssRes = ys.reduce((s, y, i) => s + (y - (a * xs[i] * xs[i] + b * xs[i] + d)) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - ym) ** 2, 0) || 1e-9;
  return { a, b, d, r2: Math.max(0, 1 - ssRes / ssTot) };
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return "-";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}

export { normalizedSlope };
