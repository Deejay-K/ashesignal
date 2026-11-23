// Public track record: every signal the engine emitted (signal_log) and every follow-up on a broadcast
// Confirmed trade (signal_followups), graded on real outcomes. Nothing here can be edited by hand; the rows
// are written by workers only. Also the user's own journal record when a user id is given.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLedgerRows, ledgerRecord, type LedgerRecord } from "./recap";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Bucket { key: string; n: number; resolved: number; wins: number; losses: number; expired: number; winRate: number | null; avgR: number | null; sumR: number }
export interface TrackRecord {
  since: string | null;
  signals: { total: Bucket; byKind: Bucket[]; byTimeframe: Bucket[]; bySide: Bucket[]; byMonth: Bucket[]; curve: { t: string; r: number }[]; recent: { symbol: string; side: string; timeframe: string; kind: string; emitted_at: string; outcome: string | null; r: number | null }[] };
  followups: { total: number; open: number; tp1: number; tp2: number; sl: number; lost: number; tp1Rate: number | null; recent: any[] };
  /** Stage 53: graded from the signal ledger (what members received), the headline. Null if the ledger is not set up yet. */
  ledger: LedgerRecord | null;
  journal: null | { total: Bucket; byTimeframe: Bucket[]; real: Bucket; paper: Bucket; curve: { t: string; r: number }[] };
}

/** R multiple of a signal_log row from its outcome (TP1/2/3 distance over stop distance; -1 for SL; 0 expired). */
export function signalR(s: { side: string; entry: number; tp1: number | null; tp2: number | null; tp3: number | null; sl1: number | null; outcome: string | null }): number | null {
  if (!s.outcome) return null;
  const e = Number(s.entry), sl = Number(s.sl1);
  const risk = Math.abs(e - sl);
  if (!(risk > 0)) return s.outcome === "sl" ? -1 : s.outcome === "expired" ? 0 : 1;
  if (s.outcome === "sl") return -1;
  if (s.outcome === "expired") return 0;
  const tp = Number(s.outcome === "tp3" ? s.tp3 : s.outcome === "tp2" ? s.tp2 : s.tp1);
  return Number.isFinite(tp) ? Math.round((Math.abs(tp - e) / risk) * 100) / 100 : 1;
}

function bucket(key: string, rows: { outcome: string | null; r: number | null }[]): Bucket {
  const resolved = rows.filter((x) => x.outcome);
  const wins = resolved.filter((x) => x.outcome?.startsWith("tp")).length;
  const losses = resolved.filter((x) => x.outcome === "sl").length;
  const expired = resolved.filter((x) => x.outcome === "expired").length;
  const rs = resolved.map((x) => x.r ?? 0);
  const sumR = Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100;
  return { key, n: rows.length, resolved: resolved.length, wins, losses, expired, winRate: wins + losses ? Math.round((100 * wins) / (wins + losses)) : null, avgR: rs.length ? Math.round((sumR / rs.length) * 100) / 100 : null, sumR };
}
const groupBy = <T,>(rows: T[], f: (r: T) => string) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = f(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); } return m; };

export async function buildTrackRecord(sb: SupabaseClient, userId?: string | null): Promise<TrackRecord> {
  const [{ data: sig }, { data: fu }, journalRes] = await Promise.all([
    sb.from("signal_log").select("symbol, side, timeframe, kind, entry, tp1, tp2, tp3, sl1, emitted_at, outcome, outcome_at").order("emitted_at", { ascending: true }).limit(5000),
    sb.from("signal_followups").select("*").order("emitted_at", { ascending: false }).limit(500),
    userId ? sb.from("saved_setups").select("symbol, side, timeframe, kind, paper, taken_at, exit_at, realized_r, status, exit_price").eq("user_id", userId).eq("taken", true).order("taken_at", { ascending: true }).limit(2000) : Promise.resolve({ data: null }),
  ]);
  const rows = (sig ?? []).map((s: any) => ({ ...s, r: signalR(s) }));
  const resolvedSorted = rows.filter((x) => x.outcome && x.outcome_at).sort((a, b) => Date.parse(a.outcome_at) - Date.parse(b.outcome_at));
  let acc = 0;
  const curve = resolvedSorted.map((x) => { acc += x.r ?? 0; return { t: x.outcome_at, r: Math.round(acc * 100) / 100 }; });
  const month = (t: string) => t.slice(0, 7);
  const signals = {
    total: bucket("all", rows),
    byKind: [...groupBy(rows, (r) => r.kind)].map(([k, v]) => bucket(k, v)).sort((a, b) => b.n - a.n),
    byTimeframe: [...groupBy(rows, (r) => r.timeframe)].map(([k, v]) => bucket(k, v)),
    bySide: [...groupBy(rows, (r) => r.side)].map(([k, v]) => bucket(k, v)),
    byMonth: [...groupBy(rows, (r) => month(r.emitted_at))].map(([k, v]) => bucket(k, v)).sort((a, b) => a.key.localeCompare(b.key)),
    curve,
    recent: rows.slice(-40).reverse().map((x) => ({ symbol: x.symbol, side: x.side, timeframe: x.timeframe, kind: x.kind, emitted_at: x.emitted_at, outcome: x.outcome, r: x.r })),
  };
  const f = fu ?? [];
  const done = f.filter((x: any) => x.closed_at);
  const followups = { total: f.length, open: f.length - done.length, tp1: f.filter((x: any) => x.tp1_at).length, tp2: f.filter((x: any) => x.tp2_at).length, sl: f.filter((x: any) => x.sl_at).length, lost: f.filter((x: any) => x.lost_at && !x.tp1_at).length, tp1Rate: done.length ? Math.round((100 * done.filter((x: any) => x.tp1_at).length) / done.length) : null, recent: f.slice(0, 30) };
  let journal: TrackRecord["journal"] = null;
  const j = (journalRes as any).data as any[] | null;
  if (j) {
    const jr = j.filter((x) => x.exit_price != null || x.realized_r != null).map((x) => ({ ...x, outcome: x.realized_r == null ? null : x.realized_r > 0 ? "tp1" : x.realized_r < 0 ? "sl" : "expired", r: x.realized_r == null ? null : Number(x.realized_r) }));
    const openJ = j.filter((x) => x.exit_price == null && x.realized_r == null).map((x) => ({ ...x, outcome: null, r: null }));
    const all = [...jr, ...openJ];
    let a2 = 0;
    const jc = jr.filter((x) => x.exit_at).sort((a, b) => Date.parse(a.exit_at) - Date.parse(b.exit_at)).map((x) => { a2 += x.r ?? 0; return { t: x.exit_at, r: Math.round(a2 * 100) / 100 }; });
    journal = { total: bucket("all", all), byTimeframe: [...groupBy(all, (r) => r.timeframe)].map(([k, v]) => bucket(k, v)), real: bucket("real", all.filter((x) => !x.paper)), paper: bucket("paper", all.filter((x) => x.paper)), curve: jc };
  }
  let ledger: LedgerRecord | null = null;
  try { ledger = ledgerRecord(await loadLedgerRows(sb, "2000-01-01T00:00:00Z")); } catch { ledger = null; }
  return { since: rows[0]?.emitted_at ?? null, signals, followups, ledger, journal };
}
