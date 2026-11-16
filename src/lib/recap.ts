// Stage 49 - weekly public recap: what every broadcast Confirmed Trade of the last 7 days did, winners and losers
// alike, in a short message for Telegram and a plain block to paste into Root or anywhere else.

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Recap {
  from: string; to: string; total: number;
  tp1: number; tp2: number; tp3: number; stopped: number; breakeven: number; cancelled: number; open: number;
  winRate: number | null; best: string[]; worst: string[];
  html: string; plain: string;
}

export async function buildRecap(sb: SupabaseClient, days = 7): Promise<Recap> {
  const to = new Date(), from = new Date(Date.now() - days * 86_400_000);
  const { data } = await sb.from("signal_followups").select("symbol, side, timeframe, emitted_at, zone_at, tp1_at, tp2_at, tp3_at, sl_at, lost_at, closed_at").gte("emitted_at", from.toISOString()).order("emitted_at", { ascending: true }).limit(500);
  const rows = (data ?? []) as any[];
  const name = (r: any) => `${r.symbol} ${r.side === "LONG" ? "long" : "short"} ${r.timeframe}`;
  const tp3 = rows.filter((r) => r.tp3_at), tp2 = rows.filter((r) => r.tp2_at), tp1 = rows.filter((r) => r.tp1_at);
  const stopped = rows.filter((r) => r.sl_at && !r.tp1_at);
  const breakeven = rows.filter((r) => r.sl_at && r.tp1_at && !r.tp2_at);
  const cancelled = rows.filter((r) => r.lost_at && !r.tp1_at && !r.sl_at);
  const open = rows.filter((r) => !r.tp1_at && !r.sl_at && !r.lost_at);
  const decided = tp1.length + stopped.length;
  const winRate = decided ? Math.round((tp1.length / decided) * 100) : null;
  const best = [...tp3.map(name), ...tp2.filter((r) => !r.tp3_at).map(name)].slice(0, 5);
  const worst = stopped.map(name).slice(0, 5);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const lines = [
    `AsheSignal - week recap (${d(from)} to ${d(to)})`,
    rows.length ? `${rows.length} Confirmed Trade${rows.length === 1 ? "" : "s"} sent.` : "No Confirmed Trades were sent this week. The engine stayed out; that happens in weak or directionless markets.",
  ];
  if (rows.length) {
    lines.push(
      `Reached TP1 or better: ${tp1.length} (TP2: ${tp2.length}, TP3: ${tp3.length})`,
      `Stopped out before TP1: ${stopped.length}`,
      `Cancelled before entry or target: ${cancelled.length}`,
      `Still open: ${open.length}`,
      winRate != null ? `Hit rate (TP1 reached vs stopped): ${winRate}%` : "Hit rate: not enough finished trades yet",
    );
    if (best.length) lines.push(`Best: ${best.join(", ")}`);
    if (worst.length) lines.push(`Stopped: ${worst.join(", ")}`);
    if (breakeven.length) lines.push(`${breakeven.length} more hit TP1 and then came back to the break-even stop.`);
  }
  lines.push("Every signal is counted, losers included. Manual trading only. Not financial advice.");
  const plain = lines.join("\n");
  const html = `📊 <b>${lines[0]}</b>\n${lines.slice(1).map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("\n")}`;
  return { from: from.toISOString(), to: to.toISOString(), total: rows.length, tp1: tp1.length, tp2: tp2.length, tp3: tp3.length, stopped: stopped.length, breakeven: breakeven.length, cancelled: cancelled.length, open: open.length, winRate, best, worst, html, plain };
}

/** ISO week id such as 2026-W47, used so the automatic recap goes out once per week. */
export function weekId(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y0) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}
