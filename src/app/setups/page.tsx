"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd } from "@/lib/format";
import { Disclaimer, Empty, Section } from "@/components/ui";

interface Row {
  id: string; asset_key: string; symbol: string; timeframe: string; side: "LONG" | "SHORT"; kind: string;
  entry_low: number; entry_high: number; tp1: number | null; tp2: number | null; tp3: number | null; sl1: number | null; sl2: number | null;
  rr: number | null; leverage: number | null; confidence: number | null; score: number | null; status: string; created_at: string;
}
const STATUSES = ["open", "tp1", "tp2", "tp3", "sl", "closed", "expired"];

export default function SetupsPage() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "ok" | "disabled">("loading");
  const load = async () => {
    const r = await fetch("/api/me/setups");
    if (r.status === 501) return setState("disabled");
    if (r.status === 401) return setState("guest");
    const j = await r.json();
    setRows(j.setups ?? []);
    setState("ok");
  };
  useEffect(() => {
    load();
  }, []);

  const stats = rows ? (() => {
    const done = rows.filter((r) => r.status !== "open");
    const wins = done.filter((r) => ["tp1", "tp2", "tp3"].includes(r.status)).length;
    return { total: rows.length, open: rows.length - done.length, resolved: done.length, winRate: done.length ? Math.round((wins / done.length) * 100) : null };
  })() : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Saved setups</h1>
        <p className="text-sm text-fg-2">Setups you saved from any analysis page. Mark how each one resolved to build your personal hit-rate. Automatic resolution via price tracking arrives in Stage 3.</p>
      </div>
      {state === "disabled" ? <Empty>Accounts are not configured on this deployment (see docs/SETUP.md).</Empty> : null}
      {state === "guest" ? <Empty><Link href="/login" className="link">Sign in</Link> to save and review setups. Guest mode does not keep them.</Empty> : null}
      {state === "loading" ? <div className="h-32 animate-pulse rounded-lg bg-bg-3" /> : null}
      {state === "ok" && rows ? (
        <>
          {stats ? (
            <div className="num grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Total", stats.total], ["Open", stats.open], ["Resolved", stats.resolved], ["Win rate", stats.winRate != null ? `${stats.winRate}%` : "-"]].map(([k, v]) => (
                <div key={k} className="card p-3"><div className="text-[11px] uppercase tracking-wider text-fg-3">{k}</div><div className="text-lg font-semibold">{v}</div></div>
              ))}
            </div>
          ) : null}
          <Section title="All setups">
            {rows.length ? (
              <div className="overflow-x-auto">
                <table>
                  <thead><tr><th>Date</th><th>Asset</th><th>TF</th><th>Side</th><th className="text-right">Entry</th><th className="text-right">SL1</th><th className="text-right">TP1 / TP2 / TP3</th><th className="text-right">R:R</th><th className="text-right">Lev</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="text-fg-3">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td><Link className="font-medium hover:text-mint" href={r.asset_key.startsWith("cg:") ? `/token/${r.asset_key.slice(3)}` : "/discover"}>{r.symbol}</Link> <span className={`pill ${r.kind === "confirmed" ? "pill-mint" : "pill-amber"}`}>{r.kind}</span></td>
                        <td>{r.timeframe}</td>
                        <td className={r.side === "LONG" ? "up" : "down"}>{r.side}</td>
                        <td className="num text-right">{fmtUsd(r.entry_low)}-{fmtUsd(r.entry_high)}</td>
                        <td className="num text-right down">{fmtUsd(r.sl1)}</td>
                        <td className="num text-right up">{fmtUsd(r.tp1)} / {fmtUsd(r.tp2)} / {fmtUsd(r.tp3)}</td>
                        <td className="num text-right">{r.rr}R</td>
                        <td className="num text-right">{r.leverage ? `${r.leverage}x` : "-"}</td>
                        <td>
                          <select value={r.status} onChange={async (e) => { await fetch("/api/me/setups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, status: e.target.value }) }); load(); }}>
                            {STATUSES.map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td><button className="btn-ghost" onClick={async () => { await fetch(`/api/me/setups?id=${r.id}`, { method: "DELETE" }); load(); }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No saved setups yet - open any token and press “Save setup”.</Empty>
            )}
          </Section>
        </>
      ) : null}
      {sb ? null : null}
      <Disclaimer />
    </div>
  );
}
