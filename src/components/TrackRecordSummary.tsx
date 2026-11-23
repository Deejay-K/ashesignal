"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface B { n: number; resolved: number; wins: number; losses: number; winRate: number | null; avgR: number | null; sumR: number }
interface L { signals: number; decided: number; open: number; wins: number; stops: number; winRate: number | null; avgR: number | null; totalR: number; maxDrawdownR: number }
interface T { since: string | null; signals: { total: B; byKind: (B & { key: string })[] }; ledger?: { since: string | null; delivered: L } | null }

function Stat({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return <div className="min-w-0"><div className="text-[11px] text-fg-3">{k}</div><div className={`num text-base font-semibold ${cls}`}>{v}</div></div>;
}
const signed = (n: number | null) => (n == null ? "-" : `${n > 0 ? "+" : ""}${n}R`);

/**
 * Real results on the dashboard, winners and losers. Stage 54: graded from what members actually received (the same
 * numbers as the weekly recap and the Track record headline). Falls back to the engine log until the ledger has results.
 */
export default function TrackRecordSummary() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => { fetch("/api/track-record").then((r) => (r.ok ? r.json() : null)).then((j) => setT(j?.signals ? j : null)).catch(() => {}); }, []);
  if (!t) return null;
  const L = t.ledger?.delivered;
  if (L && L.decided) {
    return (
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">Track record</div>
          <span className="text-xs text-fg-3">what members received, losers included{t.ledger?.since ? `, since ${new Date(t.ledger.since).toLocaleDateString()}` : ""}</span>
          <Link className="link ml-auto text-xs" href="/track-record">See every signal</Link>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Signals finished" v={String(L.decided)} />
          <Stat k="Wins vs stops" v={`${L.wins} / ${L.stops}`} />
          <Stat k="Win rate" v={L.winRate != null ? `${L.winRate}%` : "-"} cls={L.winRate != null ? (L.winRate >= 50 ? "up" : "down") : ""} />
          <Stat k="Total result" v={signed(L.totalR)} cls={L.totalR > 0 ? "up" : L.totalR < 0 ? "down" : ""} />
        </div>
        <p className="mt-2 text-[11px] text-fg-3">R means risk units: +1R is a win the size of the planned loss. Exits are counted 30/30/40 at TP1/TP2/TP3. Past results do not predict future ones.</p>
      </div>
    );
  }
  const conf = t.signals.byKind.find((k) => k.key === "confirmed") ?? t.signals.total;
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold">Track record</div>
        <span className="text-xs text-fg-3">engine log: every Confirmed setup, losers included{t.since ? `, since ${new Date(t.since).toLocaleDateString()}` : ""}</span>
        <Link className="link ml-auto text-xs" href="/track-record">See every signal</Link>
      </div>
      {conf.resolved ? (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Confirmed signals finished" v={String(conf.resolved)} />
          <Stat k="Winners vs losers" v={`${conf.wins} / ${conf.losses}`} />
          <Stat k="Win rate" v={conf.winRate != null ? `${conf.winRate}%` : "-"} cls={conf.winRate != null ? (conf.winRate >= 50 ? "up" : "down") : ""} />
          <Stat k="Average result per signal" v={signed(conf.avgR)} cls={conf.avgR != null ? (conf.avgR > 0 ? "up" : "down") : ""} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-fg-2">No finished Confirmed signals yet{t.signals.total.n ? ` (${t.signals.total.n} logged, still open)` : ""}. Results appear here as signals reach their target or stop. Nothing on that page can be edited by hand.</p>
      )}
      {conf.resolved ? <p className="mt-2 text-[11px] text-fg-3">Engine log: R counts a full exit at each target. The graded record of what members received replaces this card once it has finished trades.</p> : null}
    </div>
  );
}
