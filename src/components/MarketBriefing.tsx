"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MarketBriefing as MB } from "@/lib/ai/briefing";
import { timeAgo } from "@/lib/format";

export default function MarketBriefing() {
  const [b, setB] = useState<{ briefing: MB; createdAt: string } | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off">("loading");
  useEffect(() => {
    fetch("/api/ai/market").then(async (r) => {
      if (!r.ok) return setState("off");
      setB(await r.json());
      setState("ok");
    }).catch(() => setState("off"));
  }, []);
  if (state === "off") return null;
  if (state === "loading") return <div className="card h-28 animate-pulse" />;
  const m = b!.briefing;
  const regime = m.regime === "risk-on" ? "pill-mint" : m.regime === "risk-off" ? "pill-red" : "pill-amber";
  return (
    <section className="card border-l-4 border-mint p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-fg-3">AI market briefing</span>
        <span className={`pill ${regime}`}>{m.regime}</span>
        <span className="ml-auto text-xs text-fg-3">{timeAgo(new Date(b!.createdAt).getTime())}</span>
      </div>
      <h2 className="mt-1 text-lg font-bold">{m.headline}</h2>
      <p className="mt-1 text-sm text-fg-2">{m.summary}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm">
        <div><div className="mb-1 text-[11px] uppercase tracking-wider text-fg-3">Watch</div><ul className="list-disc pl-4 text-fg-2">{m.whatToWatch.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="mb-1 text-[11px] uppercase tracking-wider text-mint">Bullish</div><ul className="space-y-0.5 text-fg-2">{m.bullishPicks.map((p, i) => <li key={i}><Link href={`/token/${p.symbol.toLowerCase()}`} className="font-medium text-fg hover:text-mint">{p.symbol}</Link> — {p.why}</li>)}</ul></div>
        <div><div className="mb-1 text-[11px] uppercase tracking-wider text-red">Bearish</div><ul className="space-y-0.5 text-fg-2">{m.bearishPicks.map((p, i) => <li key={i}><b className="text-fg">{p.symbol}</b> — {p.why}</li>)}</ul></div>
      </div>
      {m.cautions?.length ? <p className="mt-3 text-xs text-amber">{m.cautions.join(" · ")}</p> : null}
    </section>
  );
}
