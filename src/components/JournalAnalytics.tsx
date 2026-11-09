"use client";

import { useEffect, useState } from "react";
import type { Analytics, Group } from "@/lib/analytics";
import { fmtUsd } from "@/lib/format";

/** Where your edge is: by timeframe, coin, weekday, setup kind, pre-trade verdict, leverage. */
export default function JournalAnalytics({ paper = false }: { paper?: boolean }) {
  const [a, setA] = useState<Analytics | null | undefined>(undefined);
  useEffect(() => { fetch(`/api/me/analytics${paper ? "?paper=1" : ""}`).then((r) => (r.ok ? r.json() : null)).then(setA).catch(() => setA(null)); }, [paper]);
  if (a === undefined) return <div className="skeleton h-24" />;
  if (!a) return <p className="text-sm text-fg-2">Sign in to see analytics.</p>;
  if (!a.closed) return <p className="text-sm text-fg-3">Analytics appear once you have closed trades{paper ? " (paper)" : ""}. Every closed trade counts, including the losers; especially the losers.</p>;
  const T = ({ title, rows }: { title: string; rows: Group[] }) => (
    <div className="card p-3">
      <div className="mb-1 text-xs font-semibold text-fg-2">{title}</div>
      <table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th></th><th className="text-right">n</th><th className="text-right">win</th><th className="text-right">avg R</th><th className="text-right">P&L</th></tr></thead><tbody>
        {rows.map((g) => <tr key={g.key} className="border-t border-border"><td className="py-1 font-medium">{g.key}</td><td className="num text-right">{g.n}</td><td className="num text-right">{g.winRate}%</td><td className={`num text-right ${g.avgR! >= 0 ? "up" : "down"}`}>{g.avgR! > 0 ? "+" : ""}{g.avgR}</td><td className={`num text-right ${g.pnlUsd >= 0 ? "up" : "down"}`}>{g.pnlUsd >= 0 ? "+" : ""}{fmtUsd(g.pnlUsd)}</td></tr>)}
      </tbody></table>
    </div>
  );
  return (
    <div className="space-y-3">
      {a.insights.length ? <ul className="space-y-1 rounded-xl border border-mint/30 bg-mint-dim p-3 text-sm">{a.insights.map((s, i) => <li key={i}>• {s}</li>)}</ul> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <T title="By pre-trade check verdict" rows={a.groups.byVerdict} />
        <T title="By timeframe" rows={a.groups.byTimeframe} />
        <T title="By setup kind" rows={a.groups.byKind} />
        <T title="By coin" rows={a.groups.byCoin} />
        <T title="By weekday (UTC, when taken)" rows={a.groups.byWeekday} />
        <T title="By leverage" rows={a.groups.byLeverage} />
        <T title="By side" rows={a.groups.bySide} />
        <T title="By exchange" rows={a.groups.byExchange} />
      </div>
      <p className="text-[11px] text-fg-3">{a.closed} closed {paper ? "paper " : ""}trades. Avg R is realized profit over the money you had at risk at entry; +1R means you made what you risked.</p>
    </div>
  );
}
