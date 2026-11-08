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
  const [tester, setTester] = useState(false);
  const [g, setG] = useState({ band: "35", volMin: "0.8", stretchMax: "2.5", tp1Min: "1", tp2Min: "1.5", onlyConfirmed: true, htf: false });
  const [base, setBase] = useState<(BacktestResult & { source: string; quality: string }) | null>(null);
  const qsBase = new URLSearchParams(Object.entries({ ...asset, tf }).filter(([, v]) => !!v) as [string, string][]).toString();
  const qs = tester ? `${qsBase}&band=${g.band}&volMin=${g.volMin}&stretchMax=${g.stretchMax}&tp1Min=${g.tp1Min}&tp2Min=${g.tp2Min}${g.onlyConfirmed ? "&onlyConfirmed=1" : ""}${g.htf ? "&htf=1" : ""}` : qsBase;
  useEffect(() => { setR(null); setBase(null); setState("idle"); }, [qsBase]);
  const run = async () => {
    setState("loading");
    setErr(null);
    try {
      const res = await fetch(`/api/backtest?${qs}`);
      const j = await res.json();
      if (!res.ok) { setErr(j.error); setState("error"); return; }
      setR(j);
      if (!tester) setBase(j); else if (!base) { const b = await fetch(`/api/backtest?${qsBase}`); if (b.ok) setBase(await b.json()); }
      setState("ok");
    } catch (e) { setErr(String(e)); setState("error"); }
  };
  return (
    <Section title={`Backtest the engine on ${tf}`} right={<span className="flex gap-1"><button className="btn-ghost" data-active={tester} onClick={() => setTester((v) => !v)}>Rule tester</button><button className="btn-ghost" onClick={run} disabled={state === "loading"}>{state === "loading" ? "Replaying" : r ? "Re-run" : "Run backtest"}</button></span>}>
      {tester ? (
        <div className="mb-3 rounded-lg border border-border bg-bg-2 p-3 text-xs">
          <p className="mb-2 text-fg-2">Change the confirmation gates and replay this chart with them. Production values are the placeholders; the result is compared with production below. The same variants run across the top 40 coins on the <a className="link" href="/lab">Engine Lab</a> page.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-fg-3">
            <label>Score band ±<input className="num" value={g.band} onChange={(e) => setG({ ...g, band: e.target.value })} /></label>
            <label>Min volume ratio<input className="num" value={g.volMin} onChange={(e) => setG({ ...g, volMin: e.target.value })} /></label>
            <label>Max ATR from 20 EMA<input className="num" value={g.stretchMax} onChange={(e) => setG({ ...g, stretchMax: e.target.value })} /></label>
            <label>Min TP1 (R)<input className="num" value={g.tp1Min} onChange={(e) => setG({ ...g, tp1Min: e.target.value })} /></label>
            <label>Min TP2 (R)<input className="num" value={g.tp2Min} onChange={(e) => setG({ ...g, tp2Min: e.target.value })} /></label>
          </div>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-1"><input type="checkbox" className="w-auto" checked={g.onlyConfirmed} onChange={(e) => setG({ ...g, onlyConfirmed: e.target.checked })} /> Confirmed setups only</label>
            <label className="flex items-center gap-1"><input type="checkbox" className="w-auto" checked={g.htf} onChange={(e) => setG({ ...g, htf: e.target.checked })} /> Require higher-timeframe agreement</label>
          </div>
          {r && base && r !== base ? (
            <p className="mt-2 text-fg-2">Versus production on this chart: {r.filled} vs {base.filled} trades, win rate {r.winRate ?? "-"}% vs {base.winRate ?? "-"}%, expectancy {r.expectancyR ?? "-"}R vs {base.expectancyR ?? "-"}R {r.expectancyR != null && base.expectancyR != null ? <b className={r.expectancyR - base.expectancyR >= 0.08 ? "up" : r.expectancyR - base.expectancyR <= -0.08 ? "down" : ""}>({r.expectancyR - base.expectancyR >= 0 ? "+" : ""}{(r.expectancyR - base.expectancyR).toFixed(2)}R)</b> : null}. One chart is anecdote; the Lab is evidence.</p>
          ) : null}
        </div>
      ) : null}
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
