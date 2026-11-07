"use client";

import { useEffect, useState } from "react";
import { Disclaimer, Empty, Section } from "@/components/ui";
import { fmtUsd, timeAgo } from "@/lib/format";

interface G { key: string; total: number; open: number; tp1: number; tp2: number; tp3: number; sl: number; expired: number; avgMfe: number; avgMae: number; winRate: number | null }
interface Res { total: number; byTimeframe: G[]; byKind: G[]; bySide: G[]; recent: { symbol: string; timeframe: string; side: string; kind: string; entry: number; tp1: number; sl1: number; outcome: string | null; outcome_at: string | null; emitted_at: string; max_favorable_pct: number | null; max_adverse_pct: number | null }[]; error?: string }

export default function PerformancePage() {
  const [d, setD] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/performance").then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setD(j))).catch((e) => setErr(String(e))); }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Engine performance</h1>
        <p className="text-sm text-fg-2">Every setup the engine emits on the top-30 Binance coins (1h/4h/1d) is logged and graded against real price: first touch of TP or SL1 decides. Win = TP1 or better. MFE/MAE = how far price went for/against the trade. This is the engine grading itself; it needs a few weeks of data before the numbers mean much.</p>
      </div>
      {err ? <Empty>{err === "not configured" ? "Signal logging is not configured on this deployment (needs SUPABASE_SERVICE_ROLE_KEY and the worker — SETUP.md step 5)." : err}</Empty> : null}
      {d ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Group title="By timeframe" g={d.byTimeframe} />
            <Group title="By signal kind" g={d.byKind} />
            <Group title="By side" g={d.bySide} />
          </div>
          <Section title={`Recent signals (${d.total} logged)`}>
            {d.recent.length ? (
              <div className="overflow-x-auto">
                <table>
                  <thead><tr><th>When</th><th>Asset</th><th>TF</th><th>Side</th><th>Kind</th><th className="text-right">Entry</th><th className="text-right">TP1</th><th className="text-right">SL1</th><th className="text-right">MFE / MAE</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {d.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="text-fg-3">{timeAgo(new Date(r.emitted_at).getTime())}</td>
                        <td className="font-medium">{r.symbol}</td><td>{r.timeframe}</td>
                        <td className={r.side === "LONG" ? "up" : "down"}>{r.side}</td>
                        <td><span className={`pill ${r.kind === "confirmed" ? "pill-mint" : "pill-amber"}`}>{r.kind}</span></td>
                        <td className="num text-right">{fmtUsd(r.entry)}</td><td className="num text-right up">{fmtUsd(r.tp1)}</td><td className="num text-right down">{fmtUsd(r.sl1)}</td>
                        <td className="num text-right text-fg-2">{r.max_favorable_pct ?? "—"}% / {r.max_adverse_pct ?? "—"}%</td>
                        <td><span className={`pill ${!r.outcome ? "pill-gray" : r.outcome.startsWith("tp") ? "pill-mint" : r.outcome === "sl" ? "pill-red" : "pill-amber"}`}>{r.outcome ?? "open"}{r.outcome && !r.outcome_at ? " (running)" : ""}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No signals logged yet — the worker fills this in.</Empty>}
          </Section>
        </>
      ) : !err ? <div className="h-40 animate-pulse rounded-lg bg-bg-3" /> : null}
      <Disclaimer />
    </div>
  );
}

function Group({ title, g }: { title: string; g: G[] }) {
  return (
    <Section title={title}>
      {g.length ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Group</th><th className="text-right">N</th><th className="text-right">Win %</th><th className="text-right">TP1/2/3</th><th className="text-right">SL</th><th className="text-right">MFE / MAE</th></tr></thead>
            <tbody>
              {g.map((x) => (
                <tr key={x.key}><td className="font-medium">{x.key}</td><td className="num text-right">{x.total}<span className="text-fg-3"> ({x.open} open)</span></td><td className={`num text-right ${x.winRate == null ? "" : x.winRate >= 50 ? "up" : "down"}`}>{x.winRate ?? "—"}</td><td className="num text-right text-fg-2">{x.tp1}/{x.tp2}/{x.tp3}</td><td className="num text-right down">{x.sl}</td><td className="num text-right text-fg-2">{x.avgMfe}% / {x.avgMae}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No data yet.</Empty>}
    </Section>
  );
}
