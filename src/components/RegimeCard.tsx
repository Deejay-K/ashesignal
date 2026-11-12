"use client";

import { useEffect, useState } from "react";
import { sharedJson } from "@/lib/shared-fetch";
import Link from "next/link";
import type { Regime } from "@/lib/market/regime";
import { fmtUsd } from "@/lib/format";

const TONE: Record<Regime["label"], string> = { "risk-on": "pill-mint", "risk-off": "pill-red", choppy: "pill-amber", transition: "pill-gray" };

/** Dashboard card: BTC trend, breadth and alt-season gauge with the one-line advice. */
export default function RegimeCard() {
  const [r, setR] = useState<Regime | null | undefined>(undefined);
  useEffect(() => { sharedJson<Parameters<typeof setR>[0]>("/api/regime", 60_000).then((j) => setR(j ?? null)); }, []);
  if (r === undefined) return <div className="card h-24 animate-pulse" />;
  if (!r) return null;
  const bar = (v: number, label: string, hint: string) => (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-fg-3"><span>{label}</span><span className="num">{v}%</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-bg-3"><div className={`h-full ${v >= 65 ? "bg-mint" : v <= 35 ? "bg-red" : "bg-amber"}`} style={{ width: `${v}%` }} /></div>
      <div className="mt-0.5 text-[11px] text-fg-3">{hint}</div>
    </div>
  );
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`pill ${TONE[r.label]}`}>Market regime: {r.label}</span>
        <span className="text-fg-2">{r.headline}</span>
        <Link href="/glossary#market-regime" className="link ml-auto text-xs">what this means</Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-fg-3">BTC daily</div>
          <div className="num text-sm">{r.btc.trend} · {fmtUsd(r.btc.price, { compact: true })}{r.btc.sma200 ? <span className="text-fg-3"> · 200d {fmtUsd(r.btc.sma200, { compact: true })}</span> : null}</div>
          <div className="text-[11px] text-fg-3">score {r.btc.score > 0 ? "+" : ""}{r.btc.score}, ATR {r.btc.atrPct}%, {r.btc.regime}</div>
        </div>
        {bar(r.breadth.above50, "Breadth (30d up)", `${r.breadth.label}, ${r.breadth.sample} coins`)}
        {bar(r.alts.altSeason, "Alt season gauge", `${r.alts.label}${r.alts.btcDominance != null ? `, BTC dom ${r.alts.btcDominance}%` : ""}`)}
      </div>
      <p className="mt-2 text-xs text-fg-2">{r.advice} {r.label === "risk-off" ? "Confirmed alt longs are held in Watching while this lasts." : r.label === "risk-on" && r.alts.altSeason >= 55 ? "Confirmed alt shorts are held in Watching while alts lead." : ""}</p>
    </div>
  );
}
