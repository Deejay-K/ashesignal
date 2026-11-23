/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 52 - the grader. Every signal in the ledger (Confirmed and speculative, delivered or not) is graded from the
// price candles of its own timeframe, once it is final: stop, TP3, expired, never entered, or could not be graded.
// Each outcome is written once to signal_outcomes. Nothing here changes a signal or a delivery.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOhlcv } from "./market/ohlcv";
import { SCREEN_CANDLES, HOLD_MAX_CANDLES } from "./market/signal-state";
import { gradeSignal, type LedgerSignal } from "./ledger";
import { safe } from "./fetch";
import { issue, selectIn } from "./delivery";

const LOOKBACK_MS = 10 * 86_400_000;

export interface SettleReport { open: number; graded: number; byOutcome: Record<string, number>; waiting: number; errors: number }

export async function settleOpen(sb: SupabaseClient, budgetMs = 40_000): Promise<SettleReport> {
  const started = Date.now();
  const rep: SettleReport = { open: 0, graded: 0, byOutcome: {}, waiting: 0, errors: 0 };
  const { data: sigs, error } = await sb.from("signals")
    .select("id, coingecko_id, symbol, timeframe, side, created_at, entry_low, entry_high, entry_mid, sl1, tp1, tp2, tp3")
    .gte("created_at", new Date(started - LOOKBACK_MS).toISOString()).order("created_at", { ascending: false }).limit(400);
  if (error) throw new Error(`signals: ${error.message}`);
  const ids = (sigs ?? []).map((s: any) => s.id as string);
  const done = new Set((await selectIn(ids, (ch, a, b) => sb.from("signal_outcomes").select("signal_id").in("signal_id", ch).order("signal_id", { ascending: true }).range(a, b))).map((o: any) => o.signal_id as string));
  const open = (sigs ?? []).filter((s: any) => !done.has(s.id));
  rep.open = open.length;

  // One candle request per coin and timeframe, however many signals share it.
  const groups = new Map<string, any[]>();
  for (const s of open) { const k = `${s.coingecko_id}|${s.timeframe}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(s); }
  for (const list of groups.values()) {
    if (Date.now() - started > budgetMs) { rep.waiting += list.length; continue; }
    const { symbol, coingecko_id, timeframe } = list[0];
    const k = await safe(getOhlcv({ symbol, coingeckoId: coingecko_id }, timeframe, SCREEN_CANDLES));
    if (!k.ok || k.data.quality !== "verified" || !k.data.candles.length) { rep.errors++; await issue(sb, null, "settle", `${symbol} ${timeframe}: no verified candles this run (${k.ok ? k.data.quality : k.error}); will retry`); continue; }
    for (const s of list) {
      const sig: LedgerSignal = { side: s.side, timeframe: s.timeframe, created_at: s.created_at, entry_low: Number(s.entry_low), entry_high: Number(s.entry_high), entry_mid: Number(s.entry_mid), sl1: Number(s.sl1), tp1: s.tp1 != null ? Number(s.tp1) : null, tp2: s.tp2 != null ? Number(s.tp2) : null, tp3: s.tp3 != null ? Number(s.tp3) : null };
      const g = gradeSignal(sig, k.data.candles, { maxCandlesAfterFill: HOLD_MAX_CANDLES[timeframe] ?? 30 });
      if (!g) continue; // still open: nothing is written
      const { error: ie } = await sb.from("signal_outcomes").insert({ signal_id: s.id, outcome: g.outcome, r_multiple: g.r, fill_at: g.fill_at, exit_at: g.exit_at, note: g.note });
      if (ie) { rep.errors++; await issue(sb, s.id, "settle", `outcome not saved: ${ie.message}`); continue; }
      rep.graded++; rep.byOutcome[g.outcome] = (rep.byOutcome[g.outcome] ?? 0) + 1;
      if (g.outcome === "unknown") await issue(sb, s.id, "settle", `could not be graded: ${g.note}`);
    }
  }
  return rep;
}
