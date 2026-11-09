// Journal analytics: where the user's edge is and is not. Pure grouping over closed trades.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Group { key: string; n: number; wins: number; winRate: number | null; sumR: number; avgR: number | null; pnlUsd: number }
export interface Analytics { closed: number; groups: { byTimeframe: Group[]; byCoin: Group[]; byWeekday: Group[]; byKind: Group[]; byVerdict: Group[]; byLeverage: Group[]; bySide: Group[]; byExchange: Group[] }; insights: string[] }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function group(rows: any[], f: (r: any) => string): Group[] {
  const m = new Map<string, any[]>();
  for (const r of rows) { const k = f(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m].map(([key, v]) => { const wins = v.filter((x) => Number(x.realized_r) > 0).length; const sumR = v.reduce((s, x) => s + Number(x.realized_r ?? 0), 0); return { key, n: v.length, wins, winRate: Math.round((100 * wins) / v.length), sumR: Math.round(sumR * 100) / 100, avgR: Math.round((sumR / v.length) * 100) / 100, pnlUsd: Math.round(v.reduce((s, x) => s + Number(x.realized_usd ?? 0), 0) * 100) / 100 }; }).sort((a, b) => b.n - a.n);
}

export function buildAnalytics(rows: any[], opts: { paper?: boolean } = {}): Analytics {
  const closed = rows.filter((r) => r.taken && r.realized_r != null && (opts.paper ? r.paper : !r.paper));
  const g = {
    byTimeframe: group(closed, (r) => r.timeframe ?? "?"),
    byCoin: group(closed, (r) => r.symbol).slice(0, 12),
    byWeekday: group(closed, (r) => WD[new Date(r.taken_at ?? r.created_at).getUTCDay()]),
    byKind: group(closed, (r) => r.kind ?? "?"),
    byVerdict: group(closed, (r) => r.pretrade_verdict ? (r.pretrade_verdict === "go" ? "GO" : r.pretrade_verdict === "careful" ? "CAREFUL" : "WAIT") : "not checked"),
    byLeverage: group(closed, (r) => { const l = Number(r.leverage_used ?? r.leverage ?? 1); return l <= 1 ? "1x (spot)" : l <= 3 ? "2-3x" : l <= 5 ? "4-5x" : "6x+"; }),
    bySide: group(closed, (r) => r.side),
    byExchange: group(closed, (r) => r.exchange ?? "?"),
  };
  const insights: string[] = [];
  const pick = (gs: Group[], min = 3) => gs.filter((x) => x.n >= min).sort((a, b) => b.avgR! - a.avgR!);
  const tf = pick(g.byTimeframe); if (tf.length >= 2) insights.push(`Your best timeframe is ${tf[0].key} (${tf[0].avgR! > 0 ? "+" : ""}${tf[0].avgR}R avg over ${tf[0].n}); your worst is ${tf.at(-1)!.key} (${tf.at(-1)!.avgR}R). Consider trading only ${tf[0].key} for a month.`);
  const go = g.byVerdict.find((x) => x.key === "GO"), careful = g.byVerdict.find((x) => x.key === "CAREFUL" || x.key === "WAIT");
  if (go && careful && go.n >= 3 && careful.n >= 3) insights.push(go.avgR! > careful.avgR! ? `The pre-trade check works for you: GO trades average ${go.avgR}R, CAREFUL/WAIT trades ${careful.avgR}R. Respect the warnings.` : `Interesting: your CAREFUL/WAIT trades (${careful.avgR}R) did better than GO (${go.avgR}R). Small sample; keep recording before changing anything.`);
  const kind = g.byKind.find((x) => x.key === "confirmed"), nonc = g.byKind.filter((x) => x.key !== "confirmed").reduce((s, x) => s + x.n, 0);
  if (kind && kind.n >= 3 && nonc >= 3) { const other = pick(g.byKind.filter((x) => x.key !== "confirmed"), 1); insights.push(`Confirmed setups: ${kind.winRate}% winners, ${kind.avgR}R avg. Non-confirmed: ${other.map((o) => `${o.key} ${o.avgR}R`).join(", ")}. ${kind.avgR! >= Math.max(...other.map((o) => o.avgR!)) ? "Stick to confirmed." : "Watch this: your non-confirmed trades are doing better, usually a sign of a small sample."}`); }
  const wd = pick(g.byWeekday); if (wd.length >= 3 && wd.at(-1)!.avgR! < 0) insights.push(`${wd.at(-1)!.key}s are your weak day (${wd.at(-1)!.avgR}R over ${wd.at(-1)!.n} trades).`);
  const lev = pick(g.byLeverage); if (lev.length >= 2 && lev[0].key === "1x (spot)") insights.push(`Your unleveraged trades beat your leveraged ones. Leverage multiplies the mistakes, not the edge.`);
  const coins = pick(g.byCoin); if (coins.length && coins.at(-1)!.avgR! < -0.5 && coins.at(-1)!.n >= 3) insights.push(`${coins.at(-1)!.key} keeps costing you (${coins.at(-1)!.avgR}R avg). Maybe that coin is not for you.`);
  if (closed.length < 10) insights.push(`${closed.length} closed trade${closed.length === 1 ? "" : "s"} so far. Patterns start to mean something around 20; keep recording every trade, including the bad ones.`);
  return { closed: closed.length, groups: g, insights };
}
