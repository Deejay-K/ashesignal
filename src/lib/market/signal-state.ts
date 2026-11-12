// Stage 41 - One source of truth for "is this a Confirmed trade right now?".
//
// The problem this fixes: the screener decided Confirmed from one set of candles, the Telegram card re-analysed
// from another (the user's exchange, a different candle count) and the website re-checked with strict gates every
// ten minutes. A setup sitting on a threshold flipped between the three, so a signal could be sent and then look
// "speculative" a minute later, or vanish from the website.
//
// The rule now: the screener row in coin_metrics is the signal. Once it is Confirmed, its levels are frozen (the
// plan that was sent is the plan that is shown) and it stays Confirmed until one of five plain events ends it:
// stop reached, TP1 reached, the score fades back to neutral, the setup flips side, or it gets too old.
// Every screen (screener, website, bot card, share page) asks holdCheck() the same question.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle, Timeframe } from "../types";
import { analyzeTimeframe, currentGates, type Setup, type TimeframeAnalysis } from "../ta/analysis";
import { getOhlcv } from "./ohlcv";
import { categorize, detailSnapshot } from "./categorize";
import { fmtUsd } from "../format";
import { safe } from "../fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Candle count every verdict is computed from (screener, re-checks, bot card, share page). */
export const SCREEN_CANDLES = 300;

/** How many candles of its own timeframe a Confirmed signal may stay open without reaching TP1 or the stop. */
export const HOLD_MAX_CANDLES: Record<string, number> = { "15m": 48, "1h": 36, "4h": 30, "1d": 10, "1w": 4 };
const TF_SECONDS: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };

export type HoldEnd = "stop" | "tp1" | "flip" | "faded" | "expired" | "regime";
export interface HoldResult { held: boolean; end?: HoldEnd; reason?: string }

/** The setup as stored in coin_metrics.detail.setup (see detailSnapshot). */
export interface FrozenSetup {
  side: "LONG" | "SHORT"; kind: string;
  entry: { low: number; high: number; mid: number; type?: string };
  takeProfits: { label: string; price: number; rr: number; basis?: string; reliable?: boolean }[];
  stopLosses: { label: string; price: number; basis?: string; reliable?: boolean }[];
  rr?: number; confidence?: number; leverage?: any; style?: string; holdingPeriod?: string;
  invalidation?: string[]; reasons?: string[]; issues?: string[]; confirmGaps?: string[];
}

/**
 * Does a signal that was Confirmed at `since` still stand? Pure: give it the latest analysis and candles.
 * The score may drift well inside the confirmation band before the signal ends (band minus 20, never under 10),
 * so a setup that merely wobbles around the threshold keeps its status.
 */
export function holdCheck(o: { a: TimeframeAnalysis; candles: Candle[]; setup: FrozenSetup; since: string | number; tf: Timeframe | string; band?: number; regimeOk?: boolean; regimeReason?: string | null; now?: number }): HoldResult {
  const { a, setup: s } = o;
  const long = s.side === "LONG";
  const sinceSec = typeof o.since === "number" ? o.since : Math.floor(Date.parse(o.since) / 1000);
  const nowSec = Math.floor((o.now ?? Date.now()) / 1000);
  const sl = Number(s.stopLosses?.[0]?.price), tp1 = Number(s.takeProfits?.[0]?.price);
  // Candles that opened after the signal went out: their wicks count, the candle the signal was born in does not.
  const after = Number.isFinite(sinceSec) ? o.candles.filter((k) => k.time >= sinceSec) : [];
  const lo = Math.min(a.price, ...after.map((k) => k.low)), hi = Math.max(a.price, ...after.map((k) => k.high));
  if (Number.isFinite(sl) && (long ? lo <= sl : hi >= sl)) return { held: false, end: "stop", reason: `Stop level ${fmtUsd(sl)} was reached. The trade idea is finished; wait for a new confirmation.` };
  if (Number.isFinite(tp1) && (long ? hi >= tp1 : lo <= tp1)) return { held: false, end: "tp1", reason: `TP1 ${fmtUsd(tp1)} was reached. The signal has played out; it is too late for a new entry.` };
  if (a.setup && a.setup.side !== s.side && a.setup.kind !== "watch") return { held: false, end: "flip", reason: `The engine now reads a ${a.setup.side} setup on ${o.tf}: the ${s.side} idea is no longer valid.` };
  const floor = Math.max(10, (o.band ?? currentGates().band) - 20);
  if (long ? a.score < floor : a.score > -floor) return { held: false, end: "faded", reason: `Score faded to ${a.score > 0 ? "+" : ""}${a.score} (a ${s.side} signal needs to stay ${long ? "above +" : "below -"}${floor}). Momentum behind the trade is gone.` };
  if (o.regimeOk === false) return { held: false, end: "regime", reason: o.regimeReason ?? "The market regime turned against this trade." };
  const max = HOLD_MAX_CANDLES[o.tf] ?? 30, span = TF_SECONDS[o.tf] ?? 14_400;
  if (Number.isFinite(sinceSec) && nowSec - sinceSec > max * span) return { held: false, end: "expired", reason: `${max} candles on ${o.tf} without reaching TP1 or the stop. The signal is stale; wait for a fresh one.` };
  return { held: true };
}

/** A stored setup in the shape the UI code expects from a live one. */
export function thaw(f: FrozenSetup): Setup {
  return {
    ...(f as any),
    kind: "confirmed",
    quality: { tradeable: true, issues: [], confirmGaps: [] },
    entry: { type: "pullback", ...f.entry },
    takeProfits: f.takeProfits.map((t) => ({ basis: "", reliable: true, ...t })),
    stopLosses: f.stopLosses.map((t) => ({ basis: "", reliable: true, pctFromEntry: f.entry.mid ? Math.abs((t.price - f.entry.mid) / f.entry.mid) * 100 : 0, ...t })),
    riskRewardTp2: f.rr ?? f.takeProfits[1]?.rr ?? f.takeProfits[0]?.rr ?? 0,
    confidence: f.confidence ?? 0,
    leverage: f.leverage ?? { recommended: 1, maxSafe: 1 },
    style: (f.style ?? "swing") as Setup["style"],
    holdingPeriod: f.holdingPeriod ?? "", holdingReason: "",
    invalidation: f.invalidation ?? [], reasons: f.reasons ?? [], exitEarlyIf: [], takeProfitWhen: [],
  } as Setup;
}

/** Write a lost confirmation back to the row and the history (shared by the website re-check and the bot card). */
export async function demoteRow(sb: SupabaseClient, row: { asset_key: string; symbol: string; timeframe: string; detail?: any }, a: TimeframeAnalysis, res: HoldResult): Promise<{ category: "watching"; detail: Record<string, unknown>; at: string }> {
  const now = new Date().toISOString();
  const reason = res.reason ?? "Setup no longer holds on the latest candles.";
  const strict = categorize(a, { record: row.detail?.record ?? null });
  const detail = { ...(detailSnapshot(a, strict, { record: row.detail?.record ?? null }) as Record<string, unknown>), qualifies: [], signal: { state: "ended", end: res.end ?? "faded", at: now, reason }, watch: [{ what: "Was Confirmed, signal ended", why: reason, needs: "A fresh confirmation on a later scan." }, ...(strict.category === "confirmed" ? [] : strict.watch)] };
  await sb.from("coin_metrics").update({ category: "watching", category_since: now, watch_reasons: [reason], detail, price: a.price, score: a.score, outlook: a.outlook, setup_side: a.setup?.side ?? null, setup_kind: a.setup?.kind ?? null, updated_at: now }).eq("asset_key", row.asset_key).eq("timeframe", row.timeframe).eq("category", "confirmed");
  await sb.from("category_history").insert({ asset_key: row.asset_key, symbol: row.symbol, timeframe: row.timeframe, category: "watching", prev_category: "confirmed", reason: `Signal ended: ${reason}`, snapshot: { price: a.price, score: a.score, end: res.end ?? "faded" } });
  return { category: "watching", detail, at: now };
}

export interface SignalView {
  /** active: Confirmed and still standing. ended: was Confirmed within the last day. none: no signal on this timeframe. */
  status: "active" | "ended" | "none";
  tf: Timeframe;
  since?: string; setup?: Setup; qualifies?: string[];
  endedAt?: string; endReason?: string;
  /** Other timeframes of this coin that are Confirmed right now. */
  others: { tf: Timeframe; side: string | null }[];
  /** False when there is no screener row at all for this coin (outside the top 100: no signals are sent for it). */
  screened: boolean;
}

/**
 * What the signal system says about one coin on one timeframe, re-checked live with the same rule as the screener.
 * Pass tf = null to get the coin's Confirmed timeframe when it has one (4h, then 1d, then 1h), else 4h.
 */
export async function signalView(sb: SupabaseClient | null, coin: { id: string; symbol: string }, tfIn: Timeframe | null): Promise<SignalView> {
  const fallback: SignalView = { status: "none", tf: tfIn ?? "4h", others: [], screened: false };
  if (!sb) return fallback;
  const key = `cg:${coin.id}`;
  const { data: rows } = await sb.from("coin_metrics").select("asset_key, symbol, timeframe, category, category_since, detail, updated_at").eq("asset_key", key);
  if (!rows?.length) return fallback;
  const conf = rows.filter((r: any) => r.category === "confirmed" && r.detail?.setup);
  const pick = (["4h", "1d", "1h"] as Timeframe[]).find((t) => conf.some((r: any) => r.timeframe === t));
  const tf = (tfIn ?? pick ?? "4h") as Timeframe;
  const others = conf.filter((r: any) => r.timeframe !== tf).map((r: any) => ({ tf: r.timeframe as Timeframe, side: r.detail?.setup?.side ?? null }));
  const row: any = rows.find((r: any) => r.timeframe === tf);
  const base: SignalView = { status: "none", tf, others, screened: true };
  if (row?.category === "confirmed" && row.detail?.setup) {
    const frozen = row.detail.setup as FrozenSetup;
    const live: SignalView = { ...base, status: "active", since: row.category_since ?? row.updated_at, setup: thaw(frozen), qualifies: row.detail.qualifies ?? [] };
    const k = await safe(getOhlcv({ symbol: coin.symbol, coingeckoId: coin.id }, tf, SCREEN_CANDLES));
    if (!k.ok || k.data.quality !== "verified") return live; // cannot re-check: the row stands
    const a = analyzeTimeframe(tf, k.data.candles);
    if (!a) return live;
    const res = holdCheck({ a, candles: k.data.candles, setup: frozen, since: live.since!, tf });
    if (res.held) return live;
    const d = await demoteRow(sb, { asset_key: key, symbol: row.symbol ?? coin.symbol, timeframe: tf, detail: row.detail }, a, res);
    return { ...base, status: "ended", endedAt: d.at, endReason: res.reason };
  }
  const ended = row?.detail?.signal;
  if (ended?.state === "ended" && Date.now() - Date.parse(ended.at) < 86_400_000) return { ...base, status: "ended", endedAt: ended.at, endReason: ended.reason };
  const { data: h } = await sb.from("category_history").select("reason, changed_at").eq("asset_key", key).eq("timeframe", tf).eq("prev_category", "confirmed").gt("changed_at", new Date(Date.now() - 86_400_000).toISOString()).order("changed_at", { ascending: false }).limit(1);
  if (h?.length) return { ...base, status: "ended", endedAt: h[0].changed_at, endReason: String(h[0].reason ?? "").replace(/^(Live re-check|Signal ended): /, "") || undefined };
  return base;
}

/** "3h 20m ago" style age for card headlines. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""} ago`;
  return `${Math.floor(h / 24)}d ago`;
}
