// Pure indicator math. All functions return arrays aligned to the input
// (NaN where the indicator is not yet defined) so they can be plotted directly.

import type { Candle } from "@/lib/types";

export const last = <T,>(a: T[]) => a[a.length - 1];
const isNum = (v: number) => Number.isFinite(v);

export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seed += values[i];
      continue;
    }
    if (i === period - 1) {
      seed += values[i];
      prev = seed / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
      continue;
    }
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (isNum(f[i]) && isNum(s[i]) ? f[i] - s[i] : NaN));
  // signal EMA over the defined part only
  const firstIdx = line.findIndex(isNum);
  const sig = new Array(closes.length).fill(NaN);
  if (firstIdx >= 0) {
    const sub = ema(line.slice(firstIdx), signal);
    sub.forEach((v, i) => (sig[firstIdx + i] = v));
  }
  const hist = line.map((v, i) => (isNum(v) && isNum(sig[i]) ? v - sig[i] : NaN));
  return { line, signal: sig, hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const m = mid[i];
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  const width = closes.map((_, i) => (isNum(mid[i]) && mid[i] !== 0 ? (upper[i] - lower[i]) / mid[i] : NaN));
  return { mid, upper, lower, width };
}

export function atr(candles: Candle[], period = 14): number[] {
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  // Wilder smoothing
  const out = new Array(candles.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < tr.length; i++) {
    if (i === period - 1) prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    else if (i >= period) prev = (prev * (period - 1) + tr[i]) / period;
    if (i >= period - 1) out[i] = prev;
  }
  return out;
}

/** Session-less rolling VWAP over the last `window` candles (crypto has no session). */
export function vwap(candles: Candle[], window = 50): number[] {
  const out = new Array(candles.length).fill(NaN);
  let pv = 0;
  let v = 0;
  for (let i = 0; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    pv += tp * candles[i].volume;
    v += candles[i].volume;
    if (i >= window) {
      const o = candles[i - window];
      pv -= ((o.high + o.low + o.close) / 3) * o.volume;
      v -= o.volume;
    }
    if (i >= window - 1 && v > 0) out[i] = pv / v;
  }
  return out;
}

export function fibonacci(high: number, low: number, direction: "up" | "down") {
  const range = high - low;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  return levels.map((l) => ({
    ratio: l,
    price: direction === "up" ? high - range * l : low + range * l,
  }));
}

export interface VolumeNode {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

export function volumeProfile(candles: Candle[], bins = 24): { nodes: VolumeNode[]; poc: VolumeNode | null } {
  if (!candles.length) return { nodes: [], poc: null };
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  if (hi === lo) return { nodes: [], poc: null };
  const step = (hi - lo) / bins;
  const nodes: VolumeNode[] = Array.from({ length: bins }, (_, i) => ({ priceLow: lo + i * step, priceHigh: lo + (i + 1) * step, volume: 0 }));
  for (const c of candles) {
    // distribute candle volume evenly across the bins it spans
    const a = Math.max(0, Math.min(bins - 1, Math.floor((c.low - lo) / step)));
    const b = Math.max(0, Math.min(bins - 1, Math.floor((c.high - lo) / step)));
    const share = c.volume / (b - a + 1);
    for (let i = a; i <= b; i++) nodes[i].volume += share;
  }
  const poc = nodes.reduce((m, n) => (n.volume > m.volume ? n : m), nodes[0]);
  return { nodes, poc };
}

/** Simple least-squares slope over the last n values, normalized by the mean (so it is scale-free). */
export function normalizedSlope(values: number[], n: number): number {
  const v = values.slice(-n).filter(isNum);
  if (v.length < 3) return 0;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const xs = v.map((_, i) => i);
  const xm = (v.length - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < v.length; i++) {
    num += (xs[i] - xm) * (v[i] - mean);
    den += (xs[i] - xm) ** 2;
  }
  return den === 0 || mean === 0 ? 0 : num / den / mean;
}
