"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { fmtUsd } from "@/lib/format";
import { VENUE_IDS, VENUE_META } from "@/lib/venues";
import { currentVenue } from "@/lib/venue-pref";
import type { SimResult } from "@/lib/simulator";

/** Strategy simulator: what following every signal would have done, with your balance, risk and exchange. */
export default function SimulatorPage() {
  const [balance, setBalance] = useState("500");
  const [risk, setRisk] = useState("1");
  const [kinds, setKinds] = useState<string[]>(["confirmed"]);
  const [tfs, setTfs] = useState<string[]>(["1h", "4h", "1d"]);
  const [venue, setVenue] = useState<string>("");
  const [maxOpen, setMaxOpen] = useState("3");
  const [days, setDays] = useState("365");
  const [r, setR] = useState<SimResult | null | undefined>(undefined);
  useEffect(() => { setVenue(currentVenue()); }, []);
  const run = async () => {
    setR(undefined);
    const q = new URLSearchParams({ balance, risk, kinds: kinds.join(","), tfs: tfs.join(","), maxOpen, days }); if (venue) q.set("venue", venue);
    const res = await fetch(`/api/simulate?${q}`); setR(res.ok ? await res.json() : null);
  };
  useEffect(() => { if (venue !== undefined) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [venue]);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Strategy simulator</h1>
        <p className="text-sm text-fg-2">Replays every signal the engine logged, in order, as if you had taken each one with a fixed share of your account at risk. Real outcomes from the signal log; nothing forecast.</p>
      </div>
      <div className="card grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4">
        <label>Starting balance ($)<input inputMode="decimal" className="num" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label>Risk per trade (%)<input inputMode="decimal" className="num" value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
        <label>Max open trades<input inputMode="numeric" className="num" value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} /></label>
        <label>Look back (days)<input inputMode="numeric" className="num" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <label className="col-span-2">Exchange filter<select value={venue} onChange={(e) => setVenue(e.target.value)}><option value="">all signals</option>{VENUE_IDS.map((v) => <option key={v} value={v}>{VENUE_META[v].label}{VENUE_META[v].canShort ? "" : " (longs only)"}</option>)}</select></label>
        <div className="col-span-2 flex flex-wrap items-end gap-1">
          <span className="w-full text-fg-3">Setup kinds</span>
          {["confirmed", "speculative", "watch"].map((k) => <button key={k} className={`btn-ghost !py-1 ${kinds.includes(k) ? "!border-mint !text-mint" : ""}`} onClick={() => toggle(kinds, setKinds, k)}>{k}</button>)}
          <span className="mx-1 text-fg-3">|</span>
          {["15m", "1h", "4h", "1d"].map((k) => <button key={k} className={`btn-ghost !py-1 ${tfs.includes(k) ? "!border-mint !text-mint" : ""}`} onClick={() => toggle(tfs, setTfs, k)}>{k}</button>)}
        </div>
        <div className="col-span-2 sm:col-span-4"><button className="btn" onClick={run}>Run simulation</button></div>
      </div>
      {r === undefined ? <div className="skeleton h-40" /> : !r ? <p className="text-sm text-red">Simulation failed.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="End balance" value={fmtUsd(r.endBalance)} sub={<span className={r.returnPct >= 0 ? "up" : "down"}>{r.returnPct >= 0 ? "+" : ""}{r.returnPct}%</span>} />
            <StatCard label="Trades" value={String(r.trades)} sub={`${r.wins} wins · ${r.losses} stops · ${r.expired} expired`} />
            <StatCard label="Max drawdown" value={`${r.maxDrawdownPct}%`} sub={`worst streak ${r.worstStreak}, best ${r.bestStreak}`} />
            <StatCard label="Profit factor" value={r.profitFactor == null ? "∞" : String(r.profitFactor)} sub={`avg ${r.avgR > 0 ? "+" : ""}${r.avgR}R · total ${r.totalR > 0 ? "+" : ""}${r.totalR}R`} />
          </div>
          <Section title="Equity curve"><Curve pts={r.curve} start={Number(balance) || 500} /></Section>
          {r.monthly.length ? <Section title="By month"><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th>Month</th><th className="text-right">Trades</th><th className="text-right">R</th></tr></thead><tbody>{r.monthly.map((m) => <tr key={m.key} className="border-t border-border"><td className="py-1">{m.key}</td><td className="num text-right">{m.trades}</td><td className={`num text-right ${m.r >= 0 ? "up" : "down"}`}>{m.r > 0 ? "+" : ""}{m.r}</td></tr>)}</tbody></table></div></Section> : null}
          <p className="text-xs text-fg-3">{r.note}{r.skippedVenue ? ` ${r.skippedVenue} signals skipped as not tradeable on the chosen exchange.` : ""}{r.skippedOpen ? ` ${r.skippedOpen} skipped because ${maxOpen} trades were already open.` : ""} See the <Link className="link" href="/track-record">track record</Link> for the raw signals.</p>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

function Curve({ pts, start }: { pts: { t: string; balance: number }[]; start: number }) {
  if (pts.length < 2) return <p className="text-xs text-fg-3">Not enough resolved signals to draw a curve.</p>;
  const W = 600, H = 160, pad = 6;
  const ys = pts.map((p) => p.balance); const lo = Math.min(start, ...ys), hi = Math.max(start, ...ys); const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + ((hi - v) / span) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1].balance;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label="Equity curve">
      <line x1={pad} x2={W - pad} y1={y(start)} y2={y(start)} stroke="var(--border)" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke={last >= start ? "var(--mint)" : "var(--red)"} strokeWidth={2} />
      <text x={W - pad} y={y(last) - 6} textAnchor="end" fill="var(--fg-2)" fontSize={12}>{fmtUsd(last)}</text>
    </svg>
  );
}
