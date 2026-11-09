// "What if I had taken every signal?" Replays resolved signals from signal_log with fixed fractional risk, in
// time order, compounding. Uses only outcomes the worker already graded; nothing is forecast.

import type { SupabaseClient } from "@supabase/supabase-js";
import { signalR } from "./track-record";
import { venueListings, venuesFor, VENUE_META, type VenueId } from "./venues";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SimOptions { balance: number; riskPct: number; kinds: string[]; timeframes: string[]; venue: VenueId | null; maxOpen: number; sinceDays: number }
export interface SimResult {
  trades: number; wins: number; losses: number; expired: number; skippedOpen: number; skippedVenue: number;
  endBalance: number; returnPct: number; maxDrawdownPct: number; profitFactor: number | null; avgR: number; totalR: number;
  bestStreak: number; worstStreak: number; curve: { t: string; balance: number }[]; monthly: { key: string; r: number; trades: number }[];
  note: string;
}
export const SIM_DEFAULTS: SimOptions = { balance: 500, riskPct: 1, kinds: ["confirmed"], timeframes: ["1h", "4h", "1d"], venue: null, maxOpen: 3, sinceDays: 365 };

export async function simulate(sb: SupabaseClient, o: SimOptions): Promise<SimResult> {
  const since = new Date(Date.now() - o.sinceDays * 86_400_000).toISOString();
  const [{ data: sig }, listings] = await Promise.all([
    sb.from("signal_log").select("symbol, side, timeframe, kind, entry, tp1, tp2, tp3, sl1, emitted_at, outcome, outcome_at").gte("emitted_at", since).not("outcome", "is", null).order("emitted_at", { ascending: true }).limit(5000),
    o.venue ? venueListings() : Promise.resolve(null),
  ]);
  const rows = (sig ?? []).filter((s: any) => o.kinds.includes(s.kind) && o.timeframes.includes(s.timeframe) && s.outcome_at);
  let balance = o.balance, peak = balance, maxDd = 0, wins = 0, losses = 0, expired = 0, skippedOpen = 0, skippedVenue = 0, grossWin = 0, grossLoss = 0, totalR = 0;
  let streak = 0, best = 0, worst = 0;
  const open: { until: number }[] = [];
  const curve: { t: string; balance: number }[] = [{ t: rows[0]?.emitted_at ?? new Date().toISOString(), balance }];
  const monthly = new Map<string, { r: number; trades: number }>();
  // Each signal is taken at emission, closed at outcome_at; results are applied at close in emission order
  // (an approximation; concurrent trades share the balance at entry).
  const events: { at: number; r: number; key: string }[] = [];
  for (const s of rows as any[]) {
    const at = Date.parse(s.emitted_at), until = Date.parse(s.outcome_at);
    if (o.venue && listings) { const listed = venuesFor(String(s.symbol), listings, o.venue); if (!listed.includes(o.venue) || (s.side === "SHORT" && !VENUE_META[o.venue].canShort)) { skippedVenue++; continue; } }
    for (let i = open.length - 1; i >= 0; i--) if (open[i].until <= at) open.splice(i, 1);
    if (open.length >= o.maxOpen) { skippedOpen++; continue; }
    open.push({ until });
    const r = signalR(s) ?? 0;
    events.push({ at: until, r, key: s.outcome_at.slice(0, 7) });
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    const risk = balance * (o.riskPct / 100);
    const pnl = risk * e.r;
    balance += pnl; totalR += e.r;
    if (e.r > 0) { wins++; grossWin += pnl; streak = streak > 0 ? streak + 1 : 1; best = Math.max(best, streak); }
    else if (e.r < 0) { losses++; grossLoss += -pnl; streak = streak < 0 ? streak - 1 : -1; worst = Math.min(worst, streak); }
    else expired++;
    peak = Math.max(peak, balance); maxDd = Math.max(maxDd, (peak - balance) / peak);
    curve.push({ t: new Date(e.at).toISOString(), balance: Math.round(balance * 100) / 100 });
    const m = monthly.get(e.key) ?? { r: 0, trades: 0 }; m.r += e.r; m.trades++; monthly.set(e.key, m);
  }
  const n = events.length;
  return {
    trades: n, wins, losses, expired, skippedOpen, skippedVenue,
    endBalance: Math.round(balance * 100) / 100, returnPct: Math.round(((balance - o.balance) / o.balance) * 10000) / 100, maxDrawdownPct: Math.round(maxDd * 10000) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? null : 0, avgR: n ? Math.round((totalR / n) * 100) / 100 : 0, totalR: Math.round(totalR * 100) / 100,
    bestStreak: best, worstStreak: worst, curve, monthly: [...monthly].map(([key, v]) => ({ key, r: Math.round(v.r * 100) / 100, trades: v.trades })).sort((a, b) => a.key.localeCompare(b.key)),
    note: n ? "Past signals, fixed fractional risk, fills assumed at the entry mid, no fees or slippage. It shows what the rules would have done, not what you will make." : "No resolved signals match these filters yet. The signal log grows as the worker runs.",
  };
}
