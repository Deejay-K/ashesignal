"use client";

import { useEffect, useState } from "react";
import type { ConditionsReport } from "@/lib/market/conditions";

export default function TradeConditions({ query, compact = false }: { query?: Record<string, string | undefined>; compact?: boolean }) {
  const [r, setR] = useState<ConditionsReport | null>(null);
  const [open, setOpen] = useState(false);
  const qs = new URLSearchParams(Object.entries(query ?? {}).filter(([, v]) => !!v) as [string, string][]).toString();
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/conditions${qs ? `?${qs}` : ""}`).then((x) => x.json()).then((j) => alive && setR(j)).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [qs]);
  if (!r) return <div className={`card ${compact ? "h-10" : "h-14"} animate-pulse`} />;
  const tone = r.verdict === "avoid" ? "border-red bg-red-dim" : r.verdict === "caution" ? "border-amber bg-amber-dim" : "border-mint bg-mint-dim";
  const dot = r.verdict === "avoid" ? "bg-red" : r.verdict === "caution" ? "bg-amber" : "bg-mint";
  const label = r.verdict === "avoid" ? "AVOID TRADING - HIGH RISK" : r.verdict === "caution" ? "CAUTION" : "CONDITIONS OK";
  return (
    <div className={`card border-l-4 ${tone} p-3`}>
      <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
        <b className="text-sm tracking-wide">{label}</b>
        <span className="text-xs text-fg-2">{r.verdict === "ok" ? "no macro events or liquidity problems in the window" : r.headline.replace(/^[^:]+:\s*/, "")}</span>
        <span className="ml-auto text-xs text-fg-3">{r.conditions.length} check{r.conditions.length === 1 ? "" : "s"} · {open ? "hide" : "details"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 text-sm">
          {r.conditions.length ? r.conditions.map((c, i) => (
            <div key={i} className="flex gap-2">
              <span className={`pill ${c.severity === "avoid" ? "pill-red" : c.severity === "caution" ? "pill-amber" : "pill-gray"} shrink-0`}>{c.severity}</span>
              <span><b>{c.title}</b> <span className="text-fg-2">{c.detail}</span></span>
            </div>
          )) : <p className="text-fg-3">Nothing flagged.</p>}
          {r.events.length ? (
            <div className="pt-1 text-xs text-fg-3">
              <div className="mb-1 uppercase tracking-wider">Next 48 h (USD, high/medium impact)</div>
              <ul className="space-y-0.5">{r.events.slice(0, 8).map((e, i) => <li key={i}><span className={e.impact === "High" ? "text-red" : "text-amber"}>{e.impact}</span> · {new Date(e.time).toLocaleString()} · {e.title}{e.forecast ? ` (f ${e.forecast}, p ${e.previous ?? "?"})` : ""}</li>)}</ul>
              <div className="mt-1">calendar: {r.source}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
