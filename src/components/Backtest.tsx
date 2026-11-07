"use client";

import { useEffect, useState } from "react";
import type { BacktestResult } from "@/lib/ta/backtest";
import type { Timeframe } from "@/lib/types";
import { Empty, Section } from "./ui";
import { fmtUsd } from "@/lib/format";
import type { AssetQuery } from "./AnalysisPanel";
import EquityChart from "./EquityChart";

export default function Backtest({ asset, tf }: { asset: AssetQuery; tf: Timeframe }) {
  const [r, setR] = useState<(BacktestResult & { source: string; quality: string }) | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries({ ...asset, tf }).filter(([, v]) => !!v) as [string, string][]).toString();
  useEffect(() => { setR(null); setState("idle"); }, [qs]);
  const run = async () => {
    setState("loading");
    setErr(null);
    try {
      const res = await fetch(`/api/backtest?${qs}`);
      const j = await res.json();
      if (!res.ok) { setErr(j.error); setState("error"); return; }
      setR(j);
      setState("ok");
    } catch (e) { setErr(String(e)); setState("error"); }
  };
  return (
    <Section title={`Backtest the engine on ${tf}`} right={<button className="btn-ghost" onClick={run} disabled={state === "loading"}>{state === "loading" ? "Replaying" : r ? "Re-run" : "Run backtest"}</button>}>
      {state === "idle" ? <Empty>Replays the engine over this chart's history: every setup it would have fired, graded against what price did next. Takes a few seconds.</Empty> : null}
      {state === "error" ? <p className="text-sm text-red">{err}</p> : null}
      {state === "loading" ? <div className="h-32 animate-pulse rounded-lg bg-bg-3" /> : null}
      {r ? (
        <div className="space-y-3">
          <div className="num grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat l="Signals" v={`${r.signals}`} s={`${r.filled} filled`} />
            <Stat l="Win rate" v={r.winRate != null ? `${r.winRate}%` : "-"} s={`${r.wins}W / ${r.losses}L / ${r.expired} exp`} tone={r.winRate != null ? (r.winRate >= 50 ? "up" : "down") : ""} />
            <Stat l="Expectancy" v={r.expectancyR != null ? `${r.expectancyR > 0 ? "+" : ""}${r.expectancyR}R` : "-"} s="avg R per trade" tone={r.expectancyR != null ? (r.expectancyR > 0 ? "up" : "down") : ""} />
            <Stat l="Profit factor" v={r.profitFactor != null ? `${r.profitFactor}` : "-"} s="gross win / gross loss" tone={r.profitFactor != null ? (r.profitFactor >= 1.3 ? "up" : r.profitFactor < 1 ? "down" : "") : ""} />
            <Stat l="Max drawdown" v={`${r.maxDrawdownR}R`} s="peak to trough" />
            <Stat l="By kind" v={`${r.byKind.confirmed?.winRate ?? "-"}% / ${r.byKind.speculative?.winRate ?? "-"}%`} s={`confirmed (${r.byKind.confirmed?.n ?? 0}) / spec (${r.byKind.speculative?.n ?? 0})`} />
          </div>
          {r.equity.length > 1 ? <EquityChart points={r.equity} /> : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-2">Last {r.trades.length} signals</summary>
            <div className="table-scroll mt-2">
              <table>
                <thead><tr><th>When</th><th>Side</th><th>Kind</th><th className="text-right">Entry</th><th className="text-right">SL1</th><th className="text-right">TP1</th><th>Result</th><th className="text-right">R</th><th className="text-right">Bars</th><th className="text-right">MFE / MAE</th></tr></thead>
                <tbody>
                  {[...r.trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td className="text-fg-3">{new Date(t.time * 1000).toLocaleString()}</td>
                      <td className={t.side === "LONG" ? "up" : "down"}>{t.side}</td>
                      <td><span className={`pill ${t.kind === "confirmed" ? "pill-mint" : "pill-amber"}`}>{t.kind}</span></td>
                      <td className="num text-right">{fmtUsd(t.entry)}</td><td className="num text-right down">{fmtUsd(t.sl1)}</td><td className="num text-right up">{fmtUsd(t.tp1)}</td>
                      <td><span className={`pill ${t.outcome.startsWith("tp") ? "pill-mint" : t.outcome === "sl" ? "pill-red" : "pill-gray"}`}>{t.outcome.replace("_", " ")}</span></td>
                      <td className={`num text-right ${t.r > 0 ? "up" : t.r < 0 ? "down" : ""}`}>{t.r > 0 ? "+" : ""}{t.r}</td>
                      <td className="num text-right text-fg-3">{t.bars}</td>
                      <td className="num text-right text-fg-3">{t.mfePct}% / {t.maePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="text-xs text-fg-3">{r.note} Data: {r.source} ({r.quality}).</p>
        </div>
      ) : null}
    </Section>
  );
}

function Stat({ l, v, s, tone = "" }: { l: string; v: string; s?: string; tone?: string }) {
  return <div className="card-3 p-2"><div className="text-[10px] uppercase tracking-wider text-fg-3">{l}</div><div className={`font-semibold ${tone}`}>{v}</div>{s ? <div className="text-[11px] text-fg-3">{s}</div> : null}</div>;
}
