// Weekly review: your journal week with flagged mistakes, the engine's week and the market's week.
// Pure builder over rows; used by the /review page and the Sunday report.

import { fmtUsd } from "@/lib/format";

export interface JournalRow {
  symbol: string; side: "LONG" | "SHORT"; timeframe: string; kind: string; status: string; taken_at: string | null; created_at: string;
  fill_price: number | null; size_usd: number | null; risk_usd: number | null; realized_usd: number | null; realized_r: number | null; exit_reason: string | null; exit_at: string | null;
  sl1: number | null; entry_low: number; entry_high: number; leverage: number | null; notes: string | null; max_favorable_pct?: number | null; max_adverse_pct?: number | null;
}
export interface SignalRow { kind: string; outcome: string | null; emitted_at: string; side: string; timeframe: string }
export interface HistoryRow { category: string; prev_category: string | null; changed_at: string }

export interface WeeklyReview {
  from: string; to: string;
  journal: { taken: number; closed: number; wins: number; losses: number; winRate: number | null; pnlUsd: number; avgR: number | null; bestR: { symbol: string; r: number } | null; worstR: { symbol: string; r: number } | null; open: number; flags: string[]; streak: string | null };
  engine: { confirmedNew: number; confirmedLost: number; signals: number; resolved: number; winRate: number | null };
  lessons: string[];
  text: string;
}

export function buildWeeklyReview(opts: { journal: JournalRow[]; signals: SignalRow[]; history: HistoryRow[]; tradingBalance: number | null; riskPct: number | null; from: Date; to: Date }): WeeklyReview {
  const inWeek = (iso: string | null) => !!iso && Date.parse(iso) >= opts.from.getTime() && Date.parse(iso) < opts.to.getTime();
  const real = opts.journal.filter((t) => !(t as { paper?: boolean }).paper);
  const taken = real.filter((t) => inWeek(t.taken_at ?? t.created_at));
  const closed = real.filter((t) => t.realized_r != null && inWeek(t.exit_at));
  const wins = closed.filter((t) => (t.realized_r ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.realized_r ?? 0) < 0).length;
  const pnl = closed.reduce((s, t) => s + (t.realized_usd ?? 0), 0);
  const avgR = closed.length ? +(closed.reduce((s, t) => s + (t.realized_r ?? 0), 0) / closed.length).toFixed(2) : null;
  const sorted = [...closed].sort((a, b) => (b.realized_r ?? 0) - (a.realized_r ?? 0));
  const best = sorted[0] ? { symbol: sorted[0].symbol, r: sorted[0].realized_r ?? 0 } : null;
  const worst = sorted.length ? { symbol: sorted[sorted.length - 1].symbol, r: sorted[sorted.length - 1].realized_r ?? 0 } : null;
  const open = real.filter((t) => t.realized_r == null && t.status === "open").length;
  const paperCount = opts.journal.filter((t) => (t as { paper?: boolean }).paper && inWeek(t.taken_at ?? t.created_at)).length;

  // mistakes the data can see
  const flags: string[] = [];
  const budget = opts.tradingBalance && opts.riskPct ? (opts.tradingBalance * opts.riskPct) / 100 : null;
  if (budget) {
    const over = taken.filter((t) => (t.risk_usd ?? 0) > budget * 1.3);
    if (over.length) flags.push(`${over.length} trade${over.length > 1 ? "s" : ""} risked more than your ${opts.riskPct}% budget (${fmtUsd(budget)}): ${over.map((t) => `${t.symbol} ${fmtUsd(t.risk_usd)}`).join(", ")}.`);
  }
  const spec = taken.filter((t) => t.kind !== "confirmed");
  if (spec.length) flags.push(`${spec.length} of ${taken.length} trades were not Confirmed setups (${spec.map((t) => t.symbol).join(", ")}). Speculative entries have the weaker record.`);
  const manualLoss = closed.filter((t) => t.exit_reason === "manual" && (t.realized_r ?? 0) < 0 && (t.realized_r ?? 0) > -0.9);
  if (manualLoss.length) flags.push(`${manualLoss.length} loss${manualLoss.length > 1 ? "es were" : " was"} closed by hand before the stop: fine if the setup was invalidated, a leak if it was nerves.`);
  const earlyWin = closed.filter((t) => t.exit_reason === "manual" && (t.realized_r ?? 0) > 0 && (t.realized_r ?? 0) < 0.8);
  if (earlyWin.length) flags.push(`${earlyWin.length} winner${earlyWin.length > 1 ? "s" : ""} taken below 0.8R by hand: cutting winners early is what makes a 55% win rate unprofitable.`);
  const lev = taken.filter((t) => (t.leverage ?? 1) > 5);
  if (lev.length) flags.push(`${lev.length} trade${lev.length > 1 ? "s" : ""} above 5x leverage.`);
  const noNotes = taken.filter((t) => !t.notes);
  if (taken.length && noNotes.length === taken.length) flags.push("No notes on any trade this week. One line per trade is the cheapest edge there is.");
  const weekend = taken.filter((t) => { const d = new Date(t.taken_at ?? t.created_at).getUTCDay(); return d === 0 || d === 6; });
  if (weekend.length >= 2) flags.push(`${weekend.length} trades opened on a weekend (thin liquidity).`);
  // streak
  const seq = [...closed].sort((a, b) => Date.parse(a.exit_at!) - Date.parse(b.exit_at!)).map((t) => ((t.realized_r ?? 0) > 0 ? "W" : "L"));
  let streak: string | null = null;
  if (seq.length >= 3) { const last = seq[seq.length - 1]; let n = 0; for (let i = seq.length - 1; i >= 0 && seq[i] === last; i--) n++; if (n >= 3) streak = `${n} ${last === "W" ? "wins" : "losses"} in a row${last === "L" ? ": consider halving size until the next win" : ": do not increase size because of it"}.`; }

  // engine week
  const sig = opts.signals.filter((s) => inWeek(s.emitted_at));
  const resolved = sig.filter((s) => s.outcome && s.outcome !== "expired");
  const eng = { confirmedNew: opts.history.filter((h) => h.category === "confirmed" && inWeek(h.changed_at)).length, confirmedLost: opts.history.filter((h) => h.prev_category === "confirmed" && h.category !== "confirmed" && inWeek(h.changed_at)).length, signals: sig.length, resolved: resolved.length, winRate: resolved.length ? Math.round((100 * resolved.filter((s) => String(s.outcome).startsWith("tp")).length) / resolved.length) : null };

  const lessons: string[] = [];
  if (closed.length >= 3 && avgR != null) lessons.push(avgR > 0 ? `Positive expectancy this week (${avgR}R per trade). Keep the same size; the goal is more weeks like this, not bigger ones.` : `Negative expectancy this week (${avgR}R per trade). Look at the flags above before the next trade; the fix is usually in exits, not entries.`);
  if (closed.length && wins + losses && wins / (wins + losses) >= 0.6 && (avgR ?? 0) < 0.3) lessons.push("High win rate but low R: winners are being cut short or stops are too wide relative to targets.");
  if (paperCount) lessons.push(`${paperCount} paper trade${paperCount > 1 ? "s" : ""} this week (not counted above). Paper results count when they match what you would really do, size included.`);
  if (!taken.length) lessons.push("No trades this week. If conditions were poor, that is a win. If setups were there and you hesitated, pick one next week and size it at half your normal risk.");
  if (eng.confirmedNew && taken.length === 0) lessons.push(`The engine produced ${eng.confirmedNew} new Confirmed entries you did not take. Review a few on the History feed to calibrate trust either way.`);

  const text = [
    `AsheSignal weekly review (${opts.from.toISOString().slice(0, 10)} to ${new Date(opts.to.getTime() - 1).toISOString().slice(0, 10)})`,
    "",
    `Your week: ${taken.length} trade${taken.length === 1 ? "" : "s"} taken, ${closed.length} closed (${wins} W / ${losses} L${wins + losses ? `, ${Math.round((100 * wins) / (wins + losses))}% win rate` : ""}), P&L ${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}${avgR != null ? `, ${avgR > 0 ? "+" : ""}${avgR}R per trade` : ""}. ${open} still open.`,
    best ? `Best: ${best.symbol} ${best.r > 0 ? "+" : ""}${best.r}R. Worst: ${worst!.symbol} ${worst!.r > 0 ? "+" : ""}${worst!.r}R.` : "",
    streak ?? "",
    flags.length ? "\nFlags:\n" + flags.map((f) => `- ${f}`).join("\n") : "\nNo process flags this week.",
    `\nEngine: ${eng.confirmedNew} new Confirmed entries, ${eng.confirmedLost} lost confirmation, ${eng.signals} signals logged${eng.winRate != null ? `, ${eng.winRate}% of resolved signals hit TP1` : ""}.`,
    lessons.length ? "\nLessons:\n" + lessons.map((l) => `- ${l}`).join("\n") : "",
    "\nManual trading only. Not financial advice.",
  ].filter((x) => x !== "").join("\n");

  return { from: opts.from.toISOString(), to: opts.to.toISOString(), journal: { taken: taken.length, closed: closed.length, wins, losses, winRate: wins + losses ? Math.round((100 * wins) / (wins + losses)) : null, pnlUsd: pnl, avgR, bestR: best, worstR: worst, open, flags, streak }, engine: eng, lessons, text };
}
