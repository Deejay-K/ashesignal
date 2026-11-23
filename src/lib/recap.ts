/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 52 - weekly recap from the signal ledger. The headline is what members actually received. Signals nobody
// received (speculative, or Confirmed with no member reached) are shown separately, and a combined line comes last.
// Every figure is computed from rows that are never edited (signals, signal_deliveries, signal_outcomes).

import type { SupabaseClient } from "@supabase/supabase-js";
import { statsOf, type GradedRow, type Stats } from "./ledger";
import { selectIn, selectAll } from "./delivery";
import { esc } from "./telegram";

export interface Recap {
  from: string; to: string;
  total: number;
  delivered: Stats; notDelivered: Stats; combined: Stats;
  confirmedNotDelivered: number;
  legacy: number;
  lines: string[];
  /** Telegram-sized HTML messages (each under 4096 characters). */
  messages: string[];
  plain: string;
}

const pct = (n: number | null) => (n == null ? "not enough decided trades" : `${n}%`);
const sgn = (n: number | null) => (n == null ? "n/a" : `${n > 0 ? "+" : ""}${n.toFixed(2)}`);
const dd = (n: number) => `${n.toFixed(1)}R`;

function block(title: string, st: Stats): string[] {
  return [
    title,
    `Signals: ${st.signals} | open ${st.open} | never entered ${st.noFill} | could not grade ${st.unknown}`,
    `Wins (TP1 or better): ${st.wins} | stops: ${st.stops} | expired: ${st.expired}`,
    `Win rate: ${pct(st.winRate)}${st.winRate == null ? "" : ` (${st.wins} of ${st.wins + st.stops})`}`,
    `Avg R: ${sgn(st.avgR)} | total R: ${sgn(st.totalR)}R`,
    `Max drawdown: ${dd(st.maxDrawdownR)} | longest losing streak: ${st.longestLosing}`,
  ];
}

function splitLines(rows: (GradedRow & { symbol: string })[]): string[] {
  const groups = new Map<string, GradedRow[]>();
  for (const r of rows) { const k = `${r.kind} ${r.timeframe}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) => {
    const st = statsOf(rs);
    return `${k}: ${st.signals} sent | ${st.open} open | ${st.decided} decided | ${st.wins} wins | ${pct(st.winRate)} | ${sgn(st.totalR)}R`;
  });
}

export interface LedgerRow { id: string; kind: string; timeframe: string; symbol: string; created_at: string; delivered: boolean; outcome: string | null; r: number | null; exit_at: string | null }

/** Every ledger signal since `fromIso`, with whether any member received it and its graded outcome (if final). */
export async function loadLedgerRows(sb: SupabaseClient, fromIso: string): Promise<LedgerRow[]> {
  const sigs = await selectAll<any>((a, b) => sb.from("signals").select("id, kind, timeframe, symbol, created_at").gte("created_at", fromIso).order("id", { ascending: true }).range(a, b));
  const ids = sigs.map((s) => s.id as string);
  const sentTo = new Set((await selectIn<any>(ids, (ch, a, b) => sb.from("signal_deliveries").select("signal_id").eq("status", "sent").in("signal_id", ch).order("id", { ascending: true }).range(a, b))).map((d) => d.signal_id as string));
  const outs = new Map((await selectIn<any>(ids, (ch, a, b) => sb.from("signal_outcomes").select("signal_id, outcome, r_multiple, exit_at").in("signal_id", ch).order("signal_id", { ascending: true }).range(a, b))).map((o) => [o.signal_id as string, o]));
  return sigs.map((s) => {
    const o = outs.get(s.id);
    return { id: s.id, kind: s.kind, timeframe: s.timeframe, symbol: s.symbol, created_at: s.created_at, delivered: sentTo.has(s.id), outcome: (o?.outcome ?? null) as string | null, r: o?.r_multiple != null ? Number(o.r_multiple) : null, exit_at: (o?.exit_at ?? null) as string | null };
  });
}

/** The graded record in the shape the Track record page and the bot use. Delivered and not-delivered are separate. */
export interface LedgerRecord { since: string | null; delivered: Stats; notDelivered: Stats; combined: Stats; byKindTf: { key: string; stats: Stats }[] }
export function ledgerRecord(rows: LedgerRow[]): LedgerRecord {
  const del = rows.filter((r) => r.delivered), nd = rows.filter((r) => !r.delivered);
  const groups = new Map<string, LedgerRow[]>();
  for (const r of del) { const k = `${r.kind} ${r.timeframe}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  return {
    since: rows.length ? rows.reduce((m, r) => (r.created_at < m ? r.created_at : m), rows[0].created_at) : null,
    delivered: statsOf(del), notDelivered: statsOf(nd), combined: statsOf(rows),
    byKindTf: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rs]) => ({ key, stats: statsOf(rs) })),
  };
}

export async function buildRecap(sb: SupabaseClient, days = 7): Promise<Recap> {
  const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
  const rows = await loadLedgerRows(sb, from.toISOString());
  const del = rows.filter((r) => r.delivered), nd = rows.filter((r) => !r.delivered);
  const delivered = statsOf(del), notDelivered = statsOf(nd), combined = statsOf(rows);
  const confirmedNotDelivered = nd.filter((r) => r.kind === "confirmed").length;
  // Follow-up rows from before the ledger: their delivery was never recorded per member, so they are counted, not graded.
  const { count: legacy } = await sb.from("signal_followups").select("id", { count: "exact", head: true }).is("signal_id", null).gte("emitted_at", from.toISOString());
  const d = (x: Date) => x.toISOString().slice(0, 10);

  const lines = [
    `AsheSignal weekly recap (${d(from)} to ${d(to)}, UTC)`,
    `Built from the delivery and outcome ledger. Rows are never edited.`,
    "",
    ...block("DELIVERED TO MEMBERS (the headline)", delivered),
    ...splitLines(del).map((l) => `  ${l}`),
    "",
    ...block("NOT DELIVERED (speculative and internal)", notDelivered),
    `  of which Confirmed but never delivered to anyone: ${confirmedNotDelivered}`,
    ...splitLines(nd).map((l) => `  ${l}`),
    "",
    `Combined (secondary): ${combined.signals} signals | ${combined.decided} decided | win rate ${pct(combined.winRate)} | ${sgn(combined.totalR)}R`,
  ];
  if (legacy) lines.push(`Before the ledger: ${legacy} follow-up rows with no per-member delivery record. Not counted above.`);
  lines.push(
    "",
    "R per trade: 0.30 x R at TP1 + 0.30 x R at TP2 + 0.40 x R at TP3 for the parts that filled. The rest closes at -1R (stop before TP1) or 0R (stop at break-even after TP1). Expired trades close at the last price.",
    "Win rate = wins / (wins + stops). Open trades and never-entered trades are not in it.",
    "Manual trading only. Not financial advice.",
  );

  return {
    from: from.toISOString(), to: to.toISOString(), total: rows.length,
    delivered, notDelivered, combined, confirmedNotDelivered, legacy: legacy ?? 0,
    lines, messages: recapMessages(lines), plain: lines.join("\n"),
  };
}

/** Split the recap into messages under Telegram's 4096-character limit, each shown as a copy-ready block. */
export function recapMessages(lines: string[], limit = 3300): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of lines) {
    const l = esc(line) + "\n";
    if (cur && (cur + l).length > limit) { parts.push(cur); cur = ""; }
    cur += l;
  }
  if (cur) parts.push(cur);
  return parts.map((body, i) => `${i === 0 ? "📊 <b>AsheSignal weekly recap</b>\n" : ""}<pre>${body}</pre>`);
}

/** ISO week id such as 2026-W47, used so the automatic recap goes out once per week. */
export function weekId(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y0) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}
