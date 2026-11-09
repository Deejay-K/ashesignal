"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { fmtUsd } from "@/lib/format";
import { VENUE_META } from "@/lib/venues";
import { VENUE_EVENT } from "@/lib/venue-pref";
import type { Plan } from "@/lib/plan";

/** Morning plan: the one screen to read before the day. Same data as the Telegram /plan. */
export default function PlanPage() {
  const [p, setP] = useState<(Plan & { signedIn: boolean }) | null | undefined>(undefined);
  const load = () => fetch("/api/plan").then((r) => (r.ok ? r.json() : null)).then(setP).catch(() => setP(null));
  useEffect(() => { load(); const h = () => load(); window.addEventListener(VENUE_EVENT, h); return () => window.removeEventListener(VENUE_EVENT, h); }, []);
  if (p === undefined) return <div className="space-y-3"><div className="skeleton h-8 w-48" /><div className="skeleton h-24" /><div className="skeleton h-40" /></div>;
  if (!p) return <p className="text-sm text-fg-2">The plan could not be built right now. Try again in a minute.</p>;
  const toneCls = (t: string) => (t === "up" ? "text-mint" : t === "down" ? "text-red" : t === "amber" ? "text-amber" : "text-fg-2");
  const verdictCls = p.market.verdict === "avoid" ? "border-red/50 bg-red/10" : p.market.verdict === "caution" ? "border-amber/40 bg-amber-dim" : "border-mint/40 bg-mint-dim";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Today's plan</h1>
          <p className="text-sm text-fg-2">For {VENUE_META[p.venue].label}{VENUE_META[p.venue].canShort ? "" : " (spot, longs only)"} · built {new Date(p.generatedAt).toLocaleTimeString()} · <button className="link" onClick={load}>refresh</button></p>
        </div>
        <Link href="/opportunities?cat=confirmed" className="btn-ghost text-sm">All confirmed</Link>
      </div>

      <div className={`rounded-xl border p-3 ${verdictCls}`}>
        <div className="font-semibold">{p.market.stance}</div>
        <div className="mt-1 text-sm text-fg-2">{p.market.headline}{p.market.regime ? <> · Regime <b>{p.market.regime}</b>. {p.market.regimeAdvice}</> : null}</div>
      </div>

      <Section title="Do today">
        {p.todo.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{p.todo.map((t, i) => <li key={i}>{t}</li>)}</ol> : <p className="text-sm text-fg-3">Nothing to do. Enjoy it.</p>}
      </Section>

      {p.heat ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Heat now" value={p.heat.heatPct != null ? `${p.heat.heatPct}%` : "-"} sub={`limit ${p.heat.maxHeatPct}%`} />
          <StatCard label="Open trades" value={`${p.heat.openCount} / ${p.heat.maxOpen}`} sub="real, paper excluded" />
          <StatCard label="Risk budget left" value={p.heat.budgetUsd != null ? fmtUsd(p.heat.budgetUsd) : "set balance"} sub={<Link className="link" href="/risk">Risk page</Link>} />
          <StatCard label="More trades allowed" value={String(p.heat.budgetTrades)} sub={p.heat.message || "within limits"} />
        </div>
      ) : !p.signedIn ? <p className="text-xs text-fg-3"><Link href="/login" className="link">Sign in</Link> to see your open trades, heat and risk budget here.</p> : null}

      {p.trades.length ? (
        <Section title="Your open trades" right={<Link className="link text-xs" href="/setups" title="Read-only exchange keys (Coinbase Advanced, OKX, Bybit, Kraken, Binance) let the journal match your real fills">match exchange fills</Link>}>
          <ul className="space-y-1.5 text-sm">
            {p.trades.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-bg-2 p-2">
                <div className="flex flex-wrap items-center gap-2"><b>{t.symbol}</b><span className={`pill ${t.side === "LONG" ? "pill-mint" : "pill-red"}`}>{t.side}</span><span className="pill pill-gray">{t.timeframe}</span>{t.paper ? <span className="pill pill-amber">paper</span> : null}<span className="pill pill-gray">{t.status}</span>
                  <span className="num ml-auto text-xs text-fg-2">{t.price != null ? fmtUsd(t.price) : ""}{t.pnlPct != null ? <> · <b className={t.pnlPct >= 0 ? "up" : "down"}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct}%</b></> : null}{t.toTp1Pct != null ? ` · TP1 in ${t.toTp1Pct}%` : ""}{t.toSlPct != null ? ` · stop ${t.toSlPct}% away` : ""}</span></div>
                <div className={`mt-1 text-xs ${toneCls(t.tone)}`}>{t.action}</div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`Confirmed for ${VENUE_META[p.venue].label}`} right={<Link className="link text-xs" href="/opportunities?cat=confirmed">all</Link>}>
        {p.setups.length ? <ul className="space-y-1.5 text-sm">{p.setups.map((s) => <SetupRow key={`${s.coingeckoId}${s.timeframe}`} s={s} />)}</ul> : <p className="text-sm text-fg-3">None right now. That is information too.</p>}
      </Section>
      {p.watching.length ? <Section title="Closest to confirming"><ul className="space-y-1.5 text-sm">{p.watching.map((s) => <SetupRow key={`${s.coingeckoId}${s.timeframe}`} s={s} />)}</ul></Section> : null}

      {p.events.length ? <Section title="High-impact events (next 36 h)"><ul className="text-sm">{p.events.map((e, i) => <li key={i} className="flex justify-between gap-2 border-b border-border py-1 last:border-0"><span>{e.title}</span><span className="num text-fg-3">{new Date(e.time).toLocaleString()}</span></li>)}</ul></Section> : null}
      <Disclaimer />
    </div>
  );
}

function SetupRow({ s }: { s: Plan["setups"][number] }) {
  const z = s.zone;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-2 p-2">
      <Link href={`/token/${s.coingeckoId}?tf=${s.timeframe}`} className="font-semibold hover:text-mint">{s.symbol}</Link>
      <span className={`pill ${s.side === "LONG" ? "pill-mint" : "pill-red"}`}>{s.side}</span><span className="pill pill-gray">{s.timeframe}</span>
      {s.confidence != null ? <span className="pill pill-gray">conf {s.confidence}%</span> : null}
      {z.state !== "unknown" ? <span className={`pill ${z.tone === "up" ? "pill-mint" : z.tone === "down" ? "pill-red" : z.tone === "amber" ? "pill-amber" : "pill-gray"}`}>{z.label}</span> : null}
      <span className="num ml-auto text-xs text-fg-2">{s.entry ? `entry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}` : ""}{s.stop ? ` · SL ${fmtUsd(s.stop)}` : ""}{s.tp1 ? ` · TP1 ${fmtUsd(s.tp1)}` : ""}</span>
      {s.why ? <div className="w-full text-xs text-fg-3">{s.why}</div> : null}
    </li>
  );
}
