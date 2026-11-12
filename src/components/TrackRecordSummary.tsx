"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface B { n: number; resolved: number; wins: number; losses: number; winRate: number | null; avgR: number | null; sumR: number }
interface T { since: string | null; signals: { total: B; byKind: (B & { key: string })[] }; followups: { total: number; open: number; tp1: number; sl: number; tp1Rate: number | null } }

function Stat({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return <div className="min-w-0"><div className="text-[11px] text-fg-3">{k}</div><div className={`num text-base font-semibold ${cls}`}>{v}</div></div>;
}

/** The engine's real results, winners and losers, on the dashboard. Hidden until there is something to show. */
export default function TrackRecordSummary() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => { fetch("/api/track-record").then((r) => (r.ok ? r.json() : null)).then((j) => setT(j?.signals ? j : null)).catch(() => {}); }, []);
  if (!t) return null;
  const conf = t.signals.byKind.find((k) => k.key === "confirmed") ?? t.signals.total;
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold">Track record</div>
        <span className="text-xs text-fg-3">every signal the engine sent, losers included{t.since ? `, since ${new Date(t.since).toLocaleDateString()}` : ""}</span>
        <Link className="link ml-auto text-xs" href="/track-record">See every signal</Link>
      </div>
      {conf.resolved ? (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Confirmed signals finished" v={String(conf.resolved)} />
          <Stat k="Winners vs losers" v={`${conf.wins} / ${conf.losses}`} />
          <Stat k="Win rate" v={conf.winRate != null ? `${conf.winRate}%` : "-"} cls={conf.winRate != null ? (conf.winRate >= 50 ? "up" : "down") : ""} />
          <Stat k="Average result per signal" v={conf.avgR != null ? `${conf.avgR > 0 ? "+" : ""}${conf.avgR}R` : "-"} cls={conf.avgR != null ? (conf.avgR > 0 ? "up" : "down") : ""} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-fg-2">No finished Confirmed signals yet{t.signals.total.n ? ` (${t.signals.total.n} logged, still open)` : ""}. Results appear here as signals reach their target or stop. Nothing on that page can be edited by hand.</p>
      )}
      {conf.resolved ? <p className="mt-2 text-[11px] text-fg-3">R means risk units: +1R is a win the size of the planned loss. Past results do not predict future ones.</p> : null}
    </div>
  );
}
