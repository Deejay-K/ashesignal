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

/** How long a signal stays in the grader: a daily trade needs 24 h to fill plus 10 daily candles, plus margin. */
export const GRADING_WINDOW_MS = 16 * 86_400_000;
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
 * Grade one signal from candles. Pass 1h candles for every timeframe (finer candles see the real order of events);
 * the timeframe only sets how long a trade may stay open. Returns null while the trade is still open.
 *
 * Rules, always resolved against the trade when a candle cannot say which came first:
 * - Entry: the first candle whose range touches the entry zone fills the trade, within FILL_WINDOW_HOURS.
 * - A candle that reaches the stop before any fill: if it started on the entry side of the zone it went through the
 *   zone on the way, so it is a fill and a stop (-1R). If it gapped past the zone without trading in it: no_fill.
 * - After entry, within one candle the stop is checked before the targets.
 * - R per leg: (target - entry) / (entry - stop), weighted by LEG. After TP1 the stop is at break-even (0R).
 * - Expired: still open after maxCandlesAfterFill candles of the signal's timeframe; the rest closes at the last close.
 * - forceClose: the signal is about to leave the grading window; close it now (expired at the last close, or no_fill).
 */
export function gradeSignal(sig: LedgerSignal, candles: Candle[], o: { now?: number; maxCandlesAfterFill: number; candleSeconds?: number; forceClose?: boolean }): Grade | null {
  const now = o.now ?? Date.now();
  const long = sig.side === "LONG";
  const created = Math.floor(Date.parse(sig.created_at) / 1000);
  const span = TF_SECONDS[sig.timeframe] ?? 3600;
  const step = o.candleSeconds ?? span;
  const mid = sig.entry_mid, risk = Math.abs(mid - sig.sl1);
  const fail = (note: string): Grade => ({ outcome: "unknown", r: null, fill_at: null, exit_at: null, note });
  if (!(risk > 0) || !Number.isFinite(risk) || sig.tp1 == null) return fail("missing entry, stop or TP1");
  const Rof = (p: number | null) => (p == null || !Number.isFinite(p) ? null : (long ? p - mid : mid - p) / risk);
  const r1 = Rof(sig.tp1), r2 = Rof(sig.tp2), r3 = Rof(sig.tp3);
  if (r1 == null || r1 <= 0) return fail("TP1 is on the wrong side of the entry");
  const hasTp2 = r2 != null && r2 > 0, hasTp3 = r3 != null && r3 > 0;
  const first = candles[0], last = candles[candles.length - 1];
  if (!first || !Number.isFinite(created) || first.time > created) return fail("not enough candle history to grade this signal");
  const windowEnd = created + FILL_WINDOW_HOURS * 3600;
  const after = candles.filter((k) => k.time >= created);
  const reached = (k: Candle, lvl: number) => (long ? k.high >= lvl : k.low <= lvl);
  const stopped = (k: Candle, lvl: number) => (long ? k.low <= lvl : k.high >= lvl);
  // Did this candle start on the entry side of the zone (above it for a long, below it for a short)?
  const fromEntrySide = (k: Candle) => (long ? k.open >= sig.entry_low : k.open <= sig.entry_high);
  const noFill = (at: number, note: string): Grade => ({ outcome: "no_fill", r: null, fill_at: null, exit_at: iso(at), note });

  let filled = false, fillSec = 0, got1 = false, got2 = false, sum = 0, left = 1, lastClose = mid;
  for (const k of after) {
    lastClose = k.close;
    if (!filled) {
      if (k.time >= windowEnd) return noFill(windowEnd, `entry not reached within ${FILL_WINDOW_HOURS}h`);
      const inZone = k.low <= sig.entry_high && k.high >= sig.entry_low;
      if (stopped(k, sig.sl1)) {
        if (inZone || fromEntrySide(k)) return { outcome: "stop", r: -1, fill_at: iso(k.time), exit_at: iso(k.time), note: "price went through the entry zone to the stop in one candle" };
        return noFill(k.time, "price gapped past the entry zone to the stop without trading in it");
      }
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
      return { outcome: "expired", r: rnd(sum), fill_at: iso(fillSec), exit_at: iso(k.time), note: `still open after ${o.maxCandlesAfterFill} ${sig.timeframe} candles: closed at the last price` };
    }
  }
  const covered = !!last && last.time + step >= Math.floor(now / 1000) - step;
  if (!filled) {
    // Only decide "never entered" when the candles actually reach the end of the window.
    if ((covered && now / 1000 >= windowEnd) || o.forceClose) return noFill(windowEnd, `entry not reached within ${FILL_WINDOW_HOURS}h`);
    return null;
  }
  if (o.forceClose && last) {
    sum += left * ((long ? lastClose - mid : mid - lastClose) / risk);
    return { outcome: "expired", r: rnd(sum), fill_at: iso(fillSec), exit_at: iso(last.time), note: "still open when it left the grading window: closed at the last price" };
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
  /** Price when the engine created the signal, and TP1: used to tell a fresh signal from one whose move already ran. */
  price_at_signal?: number | null; tp1?: number | null;
  rr_tp2: number | null; confidence: number | null; htf_aligned: boolean | null;
  market_rank: number | null; volume_24h: number | null;
}
export interface SpecContext {
  nowMs: number; livePrice: number | null; userTfs: string[] | null;
  /** Member's hours from UTC for quiet hours (null = UTC). */
  utcOffset?: number | null;
  /** Member's coin list (upper-case symbols). Empty or null = every coin. */
  watchlist?: string[] | null;
  sentToday: number; openSymbols: Set<string>; stoppedAt: Map<string, number>; openCount: number;
}
export type Check = { ok: true } | { ok: false; reason: string };

/** Does a speculative signal pass one preset (plus the subscriber's own timeframe picks)? First failing rule wins. */
export function specCheck(p: Preset, c: SpecCandidate, x: SpecContext): Check {
  const no = (reason: string): Check => ({ ok: false, reason });
  const tfs = x.userTfs?.length ? p.tfs.filter((t) => x.userTfs!.includes(t)) : p.tfs;
  if (!tfs.includes(c.timeframe)) return no(`timeframe ${c.timeframe} is off`);
  if (x.watchlist?.length && !x.watchlist.includes(c.symbol.toUpperCase())) return no(`${c.symbol} is not on your coin list`);
  if (c.market_rank != null && c.market_rank > p.topRank) return no(`outside the top ${p.topRank} coins`);
  if (p.minVolume > 0 && (c.volume_24h ?? 0) < p.minVolume) return no(`24h volume under $${p.minVolume / 1e6}M`);
  const stopPct = (Math.abs(c.entry_mid - c.sl1) / c.entry_mid) * 100;
  if (stopPct > p.maxStopPct) return no(`stop ${stopPct.toFixed(1)}% away, over ${p.maxStopPct}%`);
  if ((c.rr_tp2 ?? 0) < p.minRr) return no(`R:R ${c.rr_tp2 ?? "n/a"} under ${p.minRr}`);
  if ((c.confidence ?? 0) < p.minScore) return no(`score ${c.confidence ?? 0} under ${p.minScore}`);
  if (p.requireHtf && c.htf_aligned === false) return no("against the higher-timeframe trend");
  const off = x.utcOffset != null && Number.isFinite(x.utcOffset) ? Math.round(x.utcOffset) : 0;
  const h = (((new Date(x.nowMs).getUTCHours() + off) % 24) + 24) % 24;
  const quiet = p.quietFrom !== p.quietTo && (p.quietFrom < p.quietTo ? h >= p.quietFrom && h < p.quietTo : h >= p.quietFrom || h < p.quietTo);
  if (quiet) return no(x.utcOffset != null ? "quiet hours (your time)" : "quiet hours (UTC)");
  // Freshness: how far price has moved away from the entry since the signal was created. A pullback entry that sits a
  // few percent from price by design is fine; a signal whose move already ran (or reached TP1) is stale.
  if (x.livePrice == null) return no("no live price to check the entry against");
  const long = c.side === "LONG";
  if (c.tp1 != null && (long ? x.livePrice >= c.tp1 : x.livePrice <= c.tp1)) return no("price already reached TP1");
  if (long ? x.livePrice <= c.sl1 : x.livePrice >= c.sl1) return no("price is already past the stop");
  const ref = c.price_at_signal && c.price_at_signal > 0 ? c.price_at_signal : c.entry_mid;
  const ran = ((long ? x.livePrice - ref : ref - x.livePrice) / ref) * 100;
  if (ran > p.entryWithinPct) return no(`price moved ${ran.toFixed(1)}% away from the entry since the signal, over ${p.entryWithinPct}%`);
  if (x.openSymbols.has(c.symbol)) return no("you already have an open trade on this coin");
  const stop = x.stoppedAt.get(c.symbol);
  if (stop != null && x.nowMs - stop < p.cooldownStopHours * 3_600_000) return no(`stopped on this coin within ${p.cooldownStopHours}h`);
  if (x.sentToday >= p.dailyCap) return no(`daily cap of ${p.dailyCap} reached`);
  if (x.openCount >= p.openRiskR) return no(`open-risk budget of ${p.openRiskR}R is full (1R per open trade)`);
  return { ok: true };
}

// ---------- Custom limits on top of a preset ----------

/** The only values a member can pick (buttons in the bot). Anything else is ignored, so a preset can never be loosened by a typo. */
export const CUSTOM_CHOICES = {
  minRr: [1, 1.5, 2, 2.5, 3],
  maxStopPct: [2, 3, 4, 6, 8, 10],
  minScore: [40, 50, 60, 70, 80],
  dailyCap: [1, 2, 3, 4, 6, 10],
} as const;
export type CustomKey = keyof typeof CUSTOM_CHOICES;
export type SpecCustom = Partial<Record<CustomKey, number>>;

export function cleanCustom(v: unknown): SpecCustom {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: SpecCustom = {};
  for (const k of Object.keys(CUSTOM_CHOICES) as CustomKey[]) {
    const n = Number(o[k]);
    if ((CUSTOM_CHOICES[k] as readonly number[]).includes(n)) out[k] = n;
  }
  return out;
}

/** A preset with the member's own numbers applied. The fixed preset itself never changes. */
export function withCustom(p: Preset, custom: SpecCustom | null | undefined): Preset {
  const c = cleanCustom(custom);
  if (!Object.keys(c).length) return p;
  return { ...p, ...c, label: `${p.label} (your limits)` };
}

/** Upper-case coin symbols, letters and digits only, at most 40. */
export function cleanWatchlist(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((x) => x.length >= 1 && x.length <= 12))].slice(0, 40);
}

/** Valid UTC offset in whole hours (-12 to 14), else null. */
export function cleanOffset(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= -12 && n <= 14 ? n : null;
}
