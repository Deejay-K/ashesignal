// Walk-forward backtest of the engine on one timeframe: at every `step` candles, analyze the
// history up to that point, take the setup if it is tradeable, and resolve it against the
// following candles (first touch of TP1/TP2/TP3 or SL1; expiry after `maxHold` candles).
// Fills are at the entry mid; it assumes the entry zone was reached within `entryWindow` candles.

import type { Candle, Timeframe } from "@/lib/types";
import { analyzeTimeframe } from "./analysis";

export interface BacktestTrade {
  time: number; side: "LONG" | "SHORT"; kind: string; entry: number; sl1: number; tp1: number; tp2: number; tp3: number;
  outcome: "tp1" | "tp2" | "tp3" | "sl" | "expired" | "no_fill"; r: number; bars: number; mfePct: number; maePct: number;
}
export interface BacktestResult {
  timeframe: Timeframe; candles: number; signals: number; filled: number; wins: number; losses: number; expired: number;
  winRate: number | null; avgR: number | null; expectancyR: number | null; profitFactor: number | null; maxDrawdownR: number;
  equity: { time: number; r: number }[]; trades: BacktestTrade[]; byKind: Record<string, { n: number; winRate: number | null; avgR: number | null }>;
  note: string;
}

export function backtest(tf: Timeframe, candles: Candle[], opts: { step?: number; minHistory?: number; maxHold?: number; entryWindow?: number; partial?: boolean } = {}): BacktestResult {
  const step = opts.step ?? Math.max(3, Math.round(candles.length / 90));
  const minHistory = opts.minHistory ?? 120;
  const maxHold = opts.maxHold ?? 60;
  const entryWindow = opts.entryWindow ?? 8;
  const trades: BacktestTrade[] = [];
  let lastExitIdx = -1;
  for (let i = minHistory; i < candles.length - 2; i += step) {
    if (i <= lastExitIdx) continue; // one position at a time
    const a = analyzeTimeframe(tf, candles.slice(0, i + 1));
    const s = a?.setup;
    if (!s || s.kind === "watch") continue;
    const dir = s.side === "LONG" ? 1 : -1;
    // fill: entry zone touched within the window
    let fillIdx = -1;
    for (let k = i + 1; k < Math.min(candles.length, i + 1 + entryWindow); k++) {
      const c = candles[k];
      if (c.low <= s.entry.high && c.high >= s.entry.low) { fillIdx = k; break; }
    }
    const tp = s.takeProfits.map((t) => t.price);
    const sl = s.stopLosses[0].price;
    const base: Omit<BacktestTrade, "outcome" | "r" | "bars" | "mfePct" | "maePct"> = { time: candles[i].time, side: s.side, kind: s.kind, entry: s.entry.mid, sl1: sl, tp1: tp[0], tp2: tp[1], tp3: tp[2] };
    if (fillIdx < 0) { trades.push({ ...base, outcome: "no_fill", r: 0, bars: 0, mfePct: 0, maePct: 0 }); continue; }
    const risk = Math.abs(s.entry.mid - sl);
    let mfe = 0, mae = 0, outcome: BacktestTrade["outcome"] = "expired", r = 0, exitIdx = Math.min(candles.length - 1, fillIdx + maxHold);
    let reached = 0; // highest TP reached
    for (let k = fillIdx; k <= Math.min(candles.length - 1, fillIdx + maxHold); k++) {
      const c = candles[k];
      mfe = Math.max(mfe, (dir === 1 ? c.high - s.entry.mid : s.entry.mid - c.low) / s.entry.mid);
      mae = Math.max(mae, (dir === 1 ? s.entry.mid - c.low : c.high - s.entry.mid) / s.entry.mid);
      const stopHit = dir === 1 ? c.low <= sl : c.high >= sl;
      const hit = (lvl: number) => (dir === 1 ? c.high >= lvl : c.low <= lvl);
      if (stopHit && reached === 0) { outcome = "sl"; r = -1; exitIdx = k; break; }
      if (stopHit && reached > 0) { outcome = (`tp${reached}`) as BacktestTrade["outcome"]; r = partialR(tp, s.entry.mid, risk, reached, 0); exitIdx = k; break; } // stopped at break-even after TP1+
      if (hit(tp[2])) { outcome = "tp3"; r = partialR(tp, s.entry.mid, risk, 3, 3); exitIdx = k; break; }
      if (hit(tp[1])) reached = Math.max(reached, 2);
      else if (hit(tp[0])) reached = Math.max(reached, 1);
    }
    if (outcome === "expired") {
      const last = candles[exitIdx].close;
      r = reached > 0 ? partialR(tp, s.entry.mid, risk, reached, 0, last) : ((last - s.entry.mid) * dir) / risk;
    }
    lastExitIdx = exitIdx;
    trades.push({ ...base, outcome, r: round2(r), bars: exitIdx - fillIdx, mfePct: round2(mfe * 100), maePct: round2(mae * 100) });
  }
  const filled = trades.filter((t) => t.outcome !== "no_fill");
  const wins = filled.filter((t) => t.r > 0).length;
  const losses = filled.filter((t) => t.r < 0).length;
  const expired = filled.filter((t) => t.outcome === "expired").length;
  const sumR = filled.reduce((s, t) => s + t.r, 0);
  const grossWin = filled.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0);
  const grossLoss = -filled.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  let eq = 0, peak = 0, dd = 0;
  const equity = filled.map((t) => { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); return { time: t.time, r: round2(eq) }; });
  const byKind: BacktestResult["byKind"] = {};
  for (const k of ["confirmed", "speculative"]) { const ts = filled.filter((t) => t.kind === k); byKind[k] = { n: ts.length, winRate: ts.length ? Math.round((ts.filter((t) => t.r > 0).length / ts.length) * 100) : null, avgR: ts.length ? round2(ts.reduce((s, t) => s + t.r, 0) / ts.length) : null }; }
  return {
    timeframe: tf, candles: candles.length, signals: trades.length, filled: filled.length, wins, losses, expired,
    winRate: filled.length ? Math.round((wins / filled.length) * 100) : null, avgR: filled.length ? round2(sumR / filled.length) : null,
    expectancyR: filled.length ? round2(sumR / filled.length) : null, profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : grossWin > 0 ? 99 : null, maxDrawdownR: round2(dd),
    equity, trades: trades.slice(-60), byKind,
    note: `Walk-forward over ${candles.length} candles, one position at a time, entry at zone touch within ${entryWindow} bars, exits at TP/SL first touch (30/30/40 split, stop to break-even after TP1), expiry after ${maxHold} bars. No fees or slippage; treat as a relative measure of edge, not a P&L forecast.`,
  };
}

/** 30% at TP1, 30% at TP2, 40% at TP3; remainder closed at `exit` (break-even if stopped after TP1). */
function partialR(tp: number[], entry: number, risk: number, reached: number, closedAt: number, exitPrice?: number): number {
  const rOf = (p: number) => Math.abs(p - entry) / risk;
  const parts = [0.3, 0.3, 0.4];
  let r = 0;
  for (let k = 0; k < reached; k++) r += parts[k] * rOf(tp[k]);
  const rem = parts.slice(reached).reduce((a, b) => a + b, 0);
  if (closedAt === 3) return r;
  const exitR = exitPrice != null ? (Math.abs(exitPrice - entry) / risk) * Math.sign((exitPrice - entry) * (tp[0] > entry ? 1 : -1)) : 0;
  return r + rem * exitR;
}
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Compact record of the engine on this chart for the category gates (last ~300 candles, walk-forward). */
export function engineRecord(tf: Timeframe, candles: Candle[]): { n: number; winRate: number | null; expectancyR: number | null } | null {
  if (candles.length < 160) return null;
  const r = backtest(tf, candles, { step: 5, minHistory: 120, maxHold: 40 });
  const filled = r.trades.filter((t) => t.outcome !== "no_fill");
  return { n: filled.length, winRate: r.winRate, expectancyR: r.expectancyR };
}
