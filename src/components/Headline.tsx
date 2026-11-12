"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface H { title: string; tone: "up" | "down" | "amber"; facts: string[]; stance: string; move: string; confirmed: number; at: string }

/** One plain sentence at the top of the dashboard: the market's state and what it means for you today. */
export default function Headline() {
  const [h, setH] = useState<H | null | undefined>(undefined);
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    fetch("/api/headline", { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)).then((j) => setH(j?.stance ? j : null)).catch(() => setH(null)).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctl.abort(); };
  }, []);
  if (h === undefined) return <div className="card h-[76px] animate-pulse" aria-label="Loading today's headline" />;
  if (h === null) return <div className="card p-3 text-xs text-fg-3">Today&apos;s headline is unavailable right now (a data source did not answer). The cards below still work.</div>;
  const border = h.tone === "down" ? "border-red/40" : h.tone === "up" ? "border-mint/40" : "border-amber/40";
  const color = h.tone === "down" ? "down" : h.tone === "up" ? "up" : "text-amber";
  return (
    <div className={`card border ${border} p-3`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`text-base font-bold ${color}`}>{h.title}</span>
        <span className="text-xs text-fg-3">{h.facts.join(" · ")}</span>
      </div>
      <p className="mt-1 text-sm text-fg-2">{h.stance} <b className="text-fg">{h.move}</b></p>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
        <Link className="link" href={h.confirmed ? "/opportunities?cat=confirmed" : "/opportunities?cat=watching"}>{h.confirmed ? "See the trades" : "See what is being watched"}</Link>
        <Link className="link" href="/plan">Today&apos;s plan</Link>
        <Link className="link" href="/track-record">Track record</Link>
      </div>
    </div>
  );
}
