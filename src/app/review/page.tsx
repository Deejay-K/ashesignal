"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Empty, Section, StatCard } from "@/components/ui";
import { fmtUsd } from "@/lib/format";
import type { WeeklyReview } from "@/lib/review";

export default function ReviewPage() {
  const [back, setBack] = useState(0);
  const [r, setR] = useState<WeeklyReview | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "ok" | "disabled">("loading");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setState("loading");
    fetch(`/api/me/review?weeks=${back}`).then(async (x) => { if (x.status === 401) return setState("guest"); if (x.status === 501) return setState("disabled"); setR(await x.json()); setState("ok"); }).catch(() => setState("disabled"));
  }, [back]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Weekly review</h1>
          <p className="text-sm text-fg-2">Your journal week, the mistakes the data can see, and what the engine and the market did. Sent automatically on Sundays when the daily digest is on.</p>
        </div>
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost text-xs" data-active={back === 0} onClick={() => setBack(0)}>This week</button>
          <button className="btn-ghost text-xs" data-active={back === 1} onClick={() => setBack(1)}>Last week</button>
          <button className="btn-ghost text-xs" data-active={back === 2} onClick={() => setBack(2)}>2 weeks ago</button>
        </div>
      </div>
      {state === "guest" ? <Empty><Link href="/login" className="link">Sign in</Link> to get weekly reviews of your journal.</Empty> : null}
      {state === "disabled" ? <Empty>Accounts are not configured on this deployment.</Empty> : null}
      {state === "loading" ? <div className="card h-40 animate-pulse" /> : null}
      {state === "ok" && r ? (
        <>
          <div className="num grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Trades taken" value={r.journal.taken} sub={`${r.journal.open} still open`} />
            <StatCard label="Closed" value={r.journal.closed} sub={`${r.journal.wins} W / ${r.journal.losses} L`} />
            <StatCard label="Win rate" value={r.journal.winRate != null ? `${r.journal.winRate}%` : "-"} />
            <StatCard label="P&L" value={<span className={r.journal.pnlUsd >= 0 ? "up" : "down"}>{r.journal.pnlUsd >= 0 ? "+" : ""}{fmtUsd(r.journal.pnlUsd)}</span>} sub={r.journal.avgR != null ? `${r.journal.avgR > 0 ? "+" : ""}${r.journal.avgR}R per trade` : undefined} />
            <StatCard label="Best / worst" value={r.journal.bestR ? `${r.journal.bestR.r > 0 ? "+" : ""}${r.journal.bestR.r}R` : "-"} sub={r.journal.bestR ? `${r.journal.bestR.symbol} / ${r.journal.worstR?.symbol} ${r.journal.worstR?.r}R` : undefined} />
            <StatCard label="Engine" value={r.engine.confirmedNew} sub={`new confirmed · ${r.engine.winRate != null ? r.engine.winRate + "% hit TP1" : "no resolved signals"}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={`Flags (${r.journal.flags.length})`}>
              {r.journal.flags.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{r.journal.flags.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="text-sm text-fg-3">No process flags this week.</p>}
              {r.journal.streak ? <p className="mt-2 text-sm text-amber">{r.journal.streak}</p> : null}
            </Section>
            <Section title="Lessons">
              {r.lessons.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{r.lessons.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="text-sm text-fg-3">Nothing to add; keep the routine.</p>}
            </Section>
          </div>
          <Section title="Report text" right={<button className="btn-ghost text-xs" onClick={async () => { try { await navigator.clipboard.writeText(r.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Copied" : "Copy"}</button>}>
            <pre className="whitespace-pre-wrap text-xs text-fg-2">{r.text}</pre>
          </Section>
        </>
      ) : null}
      <Disclaimer />
    </div>
  );
}
