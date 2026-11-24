/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 52 - the grader. Every signal in the ledger (Confirmed and speculative, delivered or not) is graded from the
// price candles of its own timeframe, once it is final: stop, TP3, expired, never entered, or could not be graded.
// Each outcome is written once to signal_outcomes. Nothing here changes a signal or a delivery.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOhlcv } from "./market/ohlcv";
import { SCREEN_CANDLES, HOLD_MAX_CANDLES } from "./market/signal-state";
import { gradeSignal, GRADING_WINDOW_MS, type LedgerSignal } from "./ledger";
import { safe } from "./fetch";
import { issue } from "./delivery";
import { selectIn, selectAll } from "./db-pages";
import { tgSendDetailed, esc } from "./telegram";

const LOOKBACK_MS = GRADING_WINDOW_MS;
const FORCE_CLOSE_MS = LOOKBACK_MS - 86_400_000;

export interface SettleReport { open: number; graded: number; byOutcome: Record<string, number>; waiting: number; errors: number }

export async function settleOpen(sb: SupabaseClient, budgetMs = 40_000): Promise<SettleReport> {
  const started = Date.now();
  const rep: SettleReport = { open: 0, graded: 0, byOutcome: {}, waiting: 0, errors: 0 };
  // Every signal in the window (paged), so older open trades are never crowded out by newer ones.
  const sigs = await selectAll<any>((a, b) => sb.from("signals")
    .select("id, kind, coingecko_id, symbol, timeframe, side, created_at, entry_low, entry_high, entry_mid, sl1, tp1, tp2, tp3")
    .gte("created_at", new Date(started - LOOKBACK_MS).toISOString()).order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b));
  const ids = sigs.map((s: any) => s.id as string);
  const done = new Set((await selectIn(ids, (ch, a, b) => sb.from("signal_outcomes").select("signal_id").in("signal_id", ch).order("signal_id", { ascending: true }).range(a, b))).map((o: any) => o.signal_id as string));
  const open = sigs.filter((s: any) => !done.has(s.id)); // oldest first
  rep.open = open.length;

  // Graded on 1h candles for every timeframe (the real order of events inside a daily candle matters). 300 hourly
  // candles cover 12.5 days; anything older is graded on 4h candles. One candle request per coin and candle size.
  const groups = new Map<string, any[]>();
  for (const s of open) {
    const ctf = started - Date.parse(s.created_at) > 11 * 86_400_000 ? "4h" : "1h";
    const k = `${s.coingecko_id}|${ctf}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  for (const [key, list] of groups) {
    if (Date.now() - started > budgetMs) { rep.waiting += list.length; continue; }
    const ctf = key.split("|")[1] as "1h" | "4h";
    const { symbol, coingecko_id } = list[0];
    const k = await safe(getOhlcv({ symbol, coingeckoId: coingecko_id }, ctf, SCREEN_CANDLES));
    if (!k.ok || k.data.quality !== "verified" || !k.data.candles.length) {
      // Retried quietly on the next tick. A signal that never gets candles is closed as "could not grade" before it leaves the window.
      rep.errors++;
      for (const s of list) {
        if (started - Date.parse(s.created_at) < FORCE_CLOSE_MS) continue;
        const { error: ue } = await sb.from("signal_outcomes").insert({ signal_id: s.id, outcome: "unknown", r_multiple: null, note: "no verified candles for this coin during the grading window" });
        if (!ue) { rep.graded++; rep.byOutcome.unknown = (rep.byOutcome.unknown ?? 0) + 1; await issue(sb, s.id, "settle", `${symbol} ${s.timeframe}: no verified candles in ${Math.round(FORCE_CLOSE_MS / 86_400_000)} days, closed as could not grade`); }
      }
      continue;
    }
    for (const s of list) {
      const sig: LedgerSignal = { side: s.side, timeframe: s.timeframe, created_at: s.created_at, entry_low: Number(s.entry_low), entry_high: Number(s.entry_high), entry_mid: Number(s.entry_mid), sl1: Number(s.sl1), tp1: s.tp1 != null ? Number(s.tp1) : null, tp2: s.tp2 != null ? Number(s.tp2) : null, tp3: s.tp3 != null ? Number(s.tp3) : null };
      const forceClose = started - Date.parse(s.created_at) >= FORCE_CLOSE_MS;
      const g = gradeSignal(sig, k.data.candles, { maxCandlesAfterFill: HOLD_MAX_CANDLES[s.timeframe] ?? 30, candleSeconds: ctf === "1h" ? 3600 : 14_400, forceClose });
      if (!g) continue; // still open: nothing is written
      const { error: ie } = await sb.from("signal_outcomes").insert({ signal_id: s.id, outcome: g.outcome, r_multiple: g.r, fill_at: g.fill_at, exit_at: g.exit_at, note: g.note });
      if (ie) {
        if (ie.code === "23505") continue; // another run graded it first
        rep.errors++; await issue(sb, s.id, "settle", `outcome not saved: ${ie.message}`); continue;
      }
      rep.graded++; rep.byOutcome[g.outcome] = (rep.byOutcome[g.outcome] ?? 0) + 1;
      if (g.outcome === "no_fill" && s.kind === "speculative") await cancelNotice(sb, s, sig, g.note);
      if (g.outcome === "unknown") await issue(sb, s.id, "settle", `could not be graded: ${g.note}`);
    }
  }
  return rep;
}

/** A speculative alert that never reached its entry in 24 hours: tell everyone who received it, once. */
async function cancelNotice(sb: SupabaseClient, s: any, sig: LedgerSignal, why: string): Promise<void> {
  const { data: got, error } = await sb.from("signal_deliveries").select("recipient").eq("signal_id", s.id).eq("status", "sent");
  if (error) { await issue(sb, s.id, "cancel", `could not read recipients: ${error.message}`); return; }
  if (!got?.length) return; // nobody received this speculative setup: nothing to cancel, nothing to log
  const text = `🚫 <b>Speculative setup CANCELLED</b>: ${esc(s.symbol)} ${esc(sig.side)} ${esc(sig.timeframe)}\nEntry zone ${esc(String(sig.entry_low))} to ${esc(String(sig.entry_high))}. Reason: ${esc(why)}. Cancel any unfilled order for this idea.`;
  let ok = 0, failed = 0;
  for (const r of got ?? []) {
    const res = await tgSendDetailed(String(r.recipient), text, { html: true });
    if (res.ok) ok++; else failed++;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await issue(sb, s.id, "cancel", `speculative cancel notice: ${ok} sent, ${failed} failed`);
}
