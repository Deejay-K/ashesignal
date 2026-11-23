// Stage 52 - the signal ledger: pure rules, no network and no database, so they can be tested offline.
//
// Every engine signal is stored once (signals), every delivery decision is written once (signal_deliveries) and
// every final outcome is written once (signal_outcomes). Rows are never edited. The workers only set two one-time
// stamps on signals (broadcast_at, processed_at), enforced by a trigger in schema.sql.
//
// This file holds: grading a signal from candles, the speculative-alert presets (fixed in advance, not tuned on
// past results), the speculative filter check, and the recap arithmetic.

import type { Candle } from "./types";

export type SignalKind = "confirmed" | "speculative";
export type Outcome = "no_fill" | "stop" | "tp1" | "tp2" | "tp3" | "expired" | "unknown";

/** Entry must be reached within this many hours of the signal, else it counts as never entered (same for everyone). */
export const FILL_WINDOW_HOURS = 24;
/** Share of the position closed at each target (the plan users are given: 30 / 30 / 40). */
export const LEG = { tp1: 0.3, tp2: 0.3, tp3: 0.4 } as const;

const TF_SECONDS: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };
const rnd = (x: number) => Math.round(x * 100) / 100;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

export interface LedgerSignal {
  side: "LONG" | "SHORT"; timeframe: string; created_at: string;
  entry_low: number; entry_high: number; entry_mid: number;
  sl1: number; tp1: number | null; tp2: number | null; tp3: number | null;
}
export interface Grade { outcome: Outcome; r: number | null; fill_at: string | null; exit_at: string | null; note: string }

/**
 * Grade one signal from the candles. `candles` must be the series for the signal's own timeframe.
 * Returns null while the trade is still open (nothing is written then).
 *
 * Rules, conservative where a single candle cannot say which came first:
 * - Entry: the first candle whose range touches the entry zone fills the trade. A candle that touches the zone and
 *   the stop together is not counted as filled (no_fill).
 * - After entry, within one candle the stop is checked before the targets.
 * - R per leg: (target - entry) / (entry - stop), weighted by LEG. After TP1 the stop is at break-even (0R).
 * - Expired: still open after maxCandlesAfterFill candles; the rest is closed at the last close.
 */
export function gradeSignal(sig: LedgerSignal, candles: Candle[], o: { now?: number; maxCandlesAfterFill: number }): Grade | null {
  const now = o.now ?? Date.now();
  const long = sig.side === "LONG";
  const created = Math.floor(Date.parse(sig.created_at) / 1000);
  const span = TF_SECONDS[sig.timeframe] ?? 3600;
  const mid = sig.entry_mid, risk = Math.abs(mid - sig.sl1);
  const fail = (note: string): Grade => ({ outcome: "unknown", r: null, fill_at: null, exit_at: null, note });
  if (!(risk > 0) || !Number.isFinite(risk) || sig.tp1 == null) return fail("missing entry, stop or TP1");
  const Rof = (p: number | null) => (p == null || !Number.isFinite(p) ? null : (long ? p - mid : mid - p) / risk);
  const r1 = Rof(sig.tp1), r2 = Rof(sig.tp2), r3 = Rof(sig.tp3);
  if (r1 == null || r1 <= 0) return fail("TP1 is on the wrong side of the entry");
  const hasTp2 = r2 != null && r2 > 0, hasTp3 = r3 != null && r3 > 0;
  const first = candles[0], last = candles[candles.length - 1];
  if (!first || !Number.isFinite(created) || first.time > created) return fail("not enough candle history to grade this signal");
  const after = candles.filter((k) => k.time >= created);
  const reached = (k: Candle, lvl: number) => (long ? k.high >= lvl : k.low <= lvl);
  const stopped = (k: Candle, lvl: number) => (long ? k.low <= lvl : k.high >= lvl);

  let filled = false, fillSec = 0, got1 = false, got2 = false, sum = 0, left = 1;
  for (const k of after) {
    if (!filled) {
      const inZone = k.low <= sig.entry_high && k.high >= sig.entry_low;
      if (stopped(k, sig.sl1)) return { outcome: "no_fill", r: null, fill_at: null, exit_at: iso(k.time), note: inZone ? "zone and stop touched in the same candle: not counted as filled" : "stop reached before entry" };
      if (inZone) { filled = true; fillSec = k.time; }
      continue;
    }
    if (stopped(k, got1 ? mid : sig.sl1)) {
      sum += left * (got1 ? 0 : -1);
      const outcome: Outcome = got2 ? "tp2" : got1 ? "tp1" : "stop";
      return { outcome, r: rnd(sum), fill_at: iso(fillSec), exit_at: iso(k.time), note: got1 ? "stop at break-even after TP1" : "stop reached before TP1" };
    }
    if (!got1 && reached(k, sig.tp1)) { got1 = true; sum += LEG.tp1 * (r1 as number); left -= LEG.tp1; }
    if (got1 && !got2 && hasTp2 && reached(k, sig.tp2 as number)) { got2 = true; sum += LEG.tp2 * (r2 as number); left -= LEG.tp2; }
    if (got2 && hasTp3 && reached(k, sig.tp3 as number)) {
      sum += LEG.tp3 * (r3 as number);
      return { outcome: "tp3", r: rnd(sum), fill_at: iso(fillSec), exit_at: iso(k.time), note: "all three targets reached" };
    }
    if (k.time - fillSec >= o.maxCandlesAfterFill * span) {
      sum += left * ((long ? k.close - mid : mid - k.close) / risk);
      return { outcome: "expired", r: rnd(sum), fill_at: iso(fillSec), exit_at: iso(k.time), note: `still open after ${o.maxCandlesAfterFill} candles: closed at the last price` };
    }
  }
  if (!filled) {
    // Only decide "never entered" when the candles actually reach the end of the window.
    const windowEnd = created + FILL_WINDOW_HOURS * 3600;
    const covered = !!last && last.time + span >= Math.floor(now / 1000) - span;
    if (covered && now / 1000 >= windowEnd) return { outcome: "no_fill", r: null, fill_at: null, exit_at: iso(windowEnd), note: `entry not reached within ${FILL_WINDOW_HOURS}h` };
  }
  return null;
}

// ---------- Recap arithmetic ----------

export interface GradedRow { kind: string; timeframe: string; outcome: string | null; r: number | null; exit_at?: string | null }
export interface Stats {
  signals: number; open: number; noFill: number; unknown: number; decided: number;
  wins: number; stops: number; expired: number;
  winRate: number | null; avgR: number | null; totalR: number;
  /** Largest fall of the running R total, from a peak, as a negative number of R (0 = never fell). */
  maxDrawdownR: number; longestLosing: number;
}
const FINAL = new Set(["tp1", "tp2", "tp3", "stop", "expired"]);
const WIN = new Set(["tp1", "tp2", "tp3"]);

/** Win rate = wins / (wins + stops). Expired trades count in R but not in the win rate. No-fill and unknown are excluded. */
export function statsOf(rows: GradedRow[]): Stats {
  const decided = rows.filter((x) => x.outcome && FINAL.has(x.outcome) && x.r != null);
  const ordered = [...decided].sort((a, b) => (Date.parse(a.exit_at ?? "") || 0) - (Date.parse(b.exit_at ?? "") || 0));
  let eq = 0, peak = 0, dd = 0, streak = 0, longest = 0;
  for (const x of ordered) {
    const r = Number(x.r);
    eq += r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak);
    if (r < 0) { streak++; longest = Math.max(longest, streak); } else streak = 0;
  }
  const wins = decided.filter((x) => WIN.has(x.outcome as string)).length;
  const stops = decided.filter((x) => x.outcome === "stop").length;
  const expired = decided.filter((x) => x.outcome === "expired").length;
  const totalR = rnd(decided.reduce((a, x) => a + Number(x.r), 0));
  return {
    signals: rows.length,
    open: rows.filter((x) => !x.outcome).length,
    noFill: rows.filter((x) => x.outcome === "no_fill").length,
    unknown: rows.filter((x) => x.outcome === "unknown").length,
    decided: decided.length, wins, stops, expired,
    winRate: wins + stops ? Math.round((100 * wins) / (wins + stops)) : null,
    avgR: decided.length ? rnd(totalR / decided.length) : null,
    totalR,
    maxDrawdownR: rnd(dd),
    longestLosing: longest,
  };
}

// ---------- Speculative alerts: presets (fixed in advance) ----------

export type PresetId = "off" | "conservative" | "balanced" | "all";
export interface Preset {
  id: Exclude<PresetId, "off">; label: string;
  tfs: string[]; minRr: number; maxStopPct: number; minScore: number; entryWithinPct: number;
  dailyCap: number; cooldownStopHours: number; openRiskR: number;
  topRank: number; minVolume: number; requireHtf: boolean;
  /** Quiet hours in UTC: from (inclusive) to (exclusive). Equal values = off. */
  quietFrom: number; quietTo: number;
}
/** Fixed before any test. Changing a number here changes what every subscriber receives, so it is versioned in SETUP.md. */
export const PRESETS: Record<Exclude<PresetId, "off">, Preset> = {
  conservative: { id: "conservative", label: "Conservative", tfs: ["4h", "1d"], minRr: 2, maxStopPct: 4, minScore: 65, entryWithinPct: 1, dailyCap: 2, cooldownStopHours: 24, openRiskR: 3, topRank: 50, minVolume: 50_000_000, requireHtf: true, quietFrom: 23, quietTo: 7 },
  balanced: { id: "balanced", label: "Balanced", tfs: ["1h", "4h", "1d"], minRr: 1.5, maxStopPct: 6, minScore: 50, entryWithinPct: 2, dailyCap: 4, cooldownStopHours: 12, openRiskR: 5, topRank: 100, minVolume: 20_000_000, requireHtf: false, quietFrom: 0, quietTo: 6 },
  all: { id: "all", label: "All", tfs: ["1h", "4h", "1d"], minRr: 0, maxStopPct: Infinity, minScore: 0, entryWithinPct: 3, dailyCap: Infinity, cooldownStopHours: 0, openRiskR: Infinity, topRank: Infinity, minVolume: 0, requireHtf: false, quietFrom: 0, quietTo: 0 },
};
export const PRESET_IDS: Exclude<PresetId, "off">[] = ["conservative", "balanced", "all"];

export interface SpecCandidate {
  symbol: string; timeframe: string; side: "LONG" | "SHORT"; entry_mid: number; sl1: number;
  rr_tp2: number | null; confidence: number | null; htf_aligned: boolean | null;
  market_rank: number | null; volume_24h: number | null;
}
export interface SpecContext {
  nowMs: number; livePrice: number | null; userTfs: string[] | null;
  sentToday: number; openSymbols: Set<string>; stoppedAt: Map<string, number>; openCount: number;
}
export type Check = { ok: true } | { ok: false; reason: string };

/** Does a speculative signal pass one preset (plus the subscriber's own timeframe picks)? First failing rule wins. */
export function specCheck(p: Preset, c: SpecCandidate, x: SpecContext): Check {
  const no = (reason: string): Check => ({ ok: false, reason });
  const tfs = x.userTfs?.length ? p.tfs.filter((t) => x.userTfs!.includes(t)) : p.tfs;
  if (!tfs.includes(c.timeframe)) return no(`timeframe ${c.timeframe} is off`);
  if (c.market_rank != null && c.market_rank > p.topRank) return no(`outside the top ${p.topRank} coins`);
  if (p.minVolume > 0 && (c.volume_24h ?? 0) < p.minVolume) return no(`24h volume under $${p.minVolume / 1e6}M`);
  const stopPct = (Math.abs(c.entry_mid - c.sl1) / c.entry_mid) * 100;
  if (stopPct > p.maxStopPct) return no(`stop ${stopPct.toFixed(1)}% away, over ${p.maxStopPct}%`);
  if ((c.rr_tp2 ?? 0) < p.minRr) return no(`R:R ${c.rr_tp2 ?? "n/a"} under ${p.minRr}`);
  if ((c.confidence ?? 0) < p.minScore) return no(`score ${c.confidence ?? 0} under ${p.minScore}`);
  if (p.requireHtf && c.htf_aligned === false) return no("against the higher-timeframe trend");
  const h = new Date(x.nowMs).getUTCHours();
  const quiet = p.quietFrom !== p.quietTo && (p.quietFrom < p.quietTo ? h >= p.quietFrom && h < p.quietTo : h >= p.quietFrom || h < p.quietTo);
  if (quiet) return no("quiet hours (UTC)");
  if (x.livePrice == null) return no("no live price to check the entry against");
  const away = (Math.abs(x.livePrice - c.entry_mid) / c.entry_mid) * 100;
  if (away > p.entryWithinPct) return no(`price ${away.toFixed(1)}% from entry, over ${p.entryWithinPct}%`);
  if (x.openSymbols.has(c.symbol)) return no("you already have an open trade on this coin");
  const stop = x.stoppedAt.get(c.symbol);
  if (stop != null && x.nowMs - stop < p.cooldownStopHours * 3_600_000) return no(`stopped on this coin within ${p.cooldownStopHours}h`);
  if (x.sentToday >= p.dailyCap) return no(`daily cap of ${p.dailyCap} reached`);
  if (x.openCount >= p.openRiskR) return no(`open-risk budget of ${p.openRiskR}R is full (1R per open trade)`);
  return { ok: true };
}
