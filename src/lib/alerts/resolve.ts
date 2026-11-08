// Resolves open setups (saved_setups and signal_log) against live candles.
// A setup is checked on the 15m chart since its creation: first touch of SL1
// or a TP decides the outcome in order; MFE/MAE are recorded for honest stats.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOhlcv, type AssetRef } from "@/lib/market/ohlcv";
import type { Candle } from "@/lib/types";
import { deliver } from "./notify";
import { fmtUsd } from "@/lib/format";

export function assetRefFromKey(key: string, symbol: string): AssetRef {
  if (key.startsWith("cg:")) return { symbol, coingeckoId: key.slice(3) };
  if (key.startsWith("pool:")) {
    const [, network, address] = key.split(":");
    return { symbol, pool: { network, address } };
  }
  return { symbol };
}

export interface Resolvable {
  id: string;
  side: "LONG" | "SHORT";
  entry: number; // mid or stored entry
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  sl1: number | null;
  createdAt: string;
  expiresDays?: number;
}

export interface Resolution {
  status: "open" | "tp1" | "tp2" | "tp3" | "sl" | "expired";
  maxFavorablePct: number;
  maxAdversePct: number;
  note: string;
}

export function resolveAgainst(candles: Candle[], s: Resolvable): Resolution {
  const start = Math.floor(new Date(s.createdAt).getTime() / 1000);
  const since = candles.filter((c) => c.time >= start);
  const dir = s.side === "LONG" ? 1 : -1;
  let mfe = 0;
  let mae = 0;
  let best: Resolution["status"] = "open";
  const hit = (level: number | null, c: Candle) => level != null && (dir === 1 ? c.high >= level : c.low <= level);
  const stopHit = (c: Candle) => s.sl1 != null && (dir === 1 ? c.low <= s.sl1 : c.high >= s.sl1);
  for (const c of since) {
    const fav = (dir === 1 ? c.high - s.entry : s.entry - c.low) / s.entry;
    const adv = (dir === 1 ? s.entry - c.low : c.high - s.entry) / s.entry;
    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);
    // conservative: if both the stop and a target are inside the same candle, assume stop first unless a TP was already reached
    if (stopHit(c) && best === "open") return { status: "sl", maxFavorablePct: r(mfe), maxAdversePct: r(mae), note: `SL1 hit ${new Date(c.time * 1000).toISOString()}` };
    if (stopHit(c) && best !== "open") return { status: best, maxFavorablePct: r(mfe), maxAdversePct: r(mae), note: `Reached ${best.toUpperCase()} then stopped (${new Date(c.time * 1000).toISOString()})` };
    if (hit(s.tp3, c)) return { status: "tp3", maxFavorablePct: r(mfe), maxAdversePct: r(mae), note: `TP3 hit ${new Date(c.time * 1000).toISOString()}` };
    if (hit(s.tp2, c)) best = "tp2";
    else if (hit(s.tp1, c) && best === "open") best = "tp1";
  }
  const ageDays = (Date.now() - new Date(s.createdAt).getTime()) / 86_400_000;
  if (best === "open" && ageDays > (s.expiresDays ?? 30)) return { status: "expired", maxFavorablePct: r(mfe), maxAdversePct: r(mae), note: "No target or stop reached within the window." };
  return { status: best, maxFavorablePct: r(mfe), maxAdversePct: r(mae), note: best === "open" ? "Still open." : `Reached ${best.toUpperCase()}, still running.` };
}

const r = (v: number) => Math.round(v * 10000) / 100;

/** Resolve all open rows of a table. Returns counts. */
export async function resolveTable(sb: SupabaseClient, table: "saved_setups" | "signal_log") {
  const isSaved = table === "saved_setups";
  const { data, error } = await sb.from(table).select("*").is(isSaved ? "resolved_at" : "outcome_at", null).order(isSaved ? "last_checked_at" : "emitted_at", { ascending: true, nullsFirst: true }).limit(40);
  if (error) throw new Error(error.message);
  let checked = 0;
  let resolved = 0;
  const cache = new Map<string, Candle[]>();
  for (const row of data ?? []) {
    const key = row.asset_key as string;
    const symbol = row.symbol as string;
    let candles = cache.get(key);
    if (!candles) {
      const o = await getOhlcv(assetRefFromKey(key, symbol), "15m", 1000);
      candles = o.candles;
      cache.set(key, candles);
    }
    if (!candles.length) continue;
    checked++;
    const entry = isSaved ? ((row.entry_low as number) + (row.entry_high as number)) / 2 : (row.entry as number);
    const res = resolveAgainst(candles, { id: row.id, side: row.side, entry, tp1: row.tp1, tp2: row.tp2, tp3: row.tp3, sl1: row.sl1, createdAt: isSaved ? row.created_at : row.emitted_at });
    const done = res.status !== "open" && (isSaved ? row.status !== res.status || ["sl", "tp3", "expired"].includes(res.status) : true);
    const patch: Record<string, unknown> = isSaved
      ? { last_checked_at: new Date().toISOString(), max_favorable_pct: res.maxFavorablePct, max_adverse_pct: res.maxAdversePct, outcome_note: res.note }
      : { max_favorable_pct: res.maxFavorablePct, max_adverse_pct: res.maxAdversePct };
    if (isSaved) {
      // only auto-advance status if the user hasn't manually set it beyond what price shows
      if (res.status !== "open" && row.status === "open") patch.status = res.status;
      else if (res.status !== "open" && ["tp1", "tp2"].includes(row.status) && ["tp2", "tp3", "sl"].includes(res.status)) patch.status = res.status;
      if (["sl", "tp3", "expired"].includes(String(patch.status ?? row.status))) patch.resolved_at = new Date().toISOString();
    } else if (res.status !== "open" && ["sl", "tp3", "expired"].includes(res.status)) {
      patch.outcome = res.status;
      patch.outcome_at = new Date().toISOString();
    } else if (res.status === "tp1" || res.status === "tp2") {
      patch.outcome = res.status; // provisional; finalised when tp3/sl/expiry hits
    }
    if (done) resolved++;
    // Journal trades: tell the user when the status moves (TP1/TP2/TP3 reached, stop hit, expired), once per status.
    if (isSaved && row.taken && patch.status && patch.status !== row.status && patch.status !== row.notified_status) {
      const st = String(patch.status);
      const units = Number(row.size_units ?? 0);
      const fill = Number(row.fill_price ?? entry);
      const lvl = st === "sl" ? Number(row.sl1) : st.startsWith("tp") ? Number(row[st as "tp1" | "tp2" | "tp3"]) : null;
      const dir = row.side === "LONG" ? 1 : -1;
      const pnl = lvl != null && units > 0 ? (lvl - fill) * dir * units : null;
      const title = st === "sl" ? `${row.symbol} ${row.side}: stop reached at ${fmtUsd(lvl)}` : st === "expired" ? `${row.symbol} ${row.side}: no target or stop within 30 days` : `${row.symbol} ${row.side}: ${st.toUpperCase()} reached at ${fmtUsd(lvl)}`;
      const body = `${st === "sl" ? "Your exchange stop should have closed the position." : st.startsWith("tp") ? `Take the ${st === "tp1" ? "first 30%" : st === "tp2" ? "next 30%" : "rest"} if it has not filled, ${st === "tp1" ? "and move the stop to break-even at " + fmtUsd(fill) : "and trail the stop"}.` : "Consider closing or re-evaluating."}${pnl != null ? ` Estimated ${pnl >= 0 ? "profit" : "loss"} on this leg: ${fmtUsd(Math.abs(pnl))}.` : ""} Record your real exit in the journal.`;
      await deliver(sb, { userId: row.user_id, alertId: null, symbol: row.symbol, title, body, url: "/setups" });
      patch.notified_status = st;
    }
    await sb.from(table).update(patch).eq("id", row.id);
  }
  return { checked, resolved };
}
