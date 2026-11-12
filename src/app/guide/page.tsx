"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Disclaimer, Section } from "@/components/ui";
import { buildGuide, guideToText, tradePageUrl, type Market } from "@/lib/guide/trade-steps";
import { VENUE_IDS, VENUE_META, isVenueId, type VenueId } from "@/lib/venues";
import { currentVenue, setVenue } from "@/lib/venue-pref";
import { fmtUsd } from "@/lib/format";
import OrderTicket from "@/components/OrderTicket";

export default function GuidePage() {
  return <Suspense fallback={<div className="card h-40 animate-pulse" />}><GuideInner /></Suspense>;
}

function GuideInner() {
  const sp = useSearchParams();
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isFinite(v) && v > 0 ? v : 0; };
  const hasSetup = n("entry") > 0 && n("stop") > 0;
  const [venue, setV] = useState<VenueId>("binance");
  const [market, setMarket] = useState<Market>("spot");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const q = sp.get("venue");
    const v = isVenueId(q) ? q : currentVenue();
    setV(v);
    const side = sp.get("side");
    const lev = n("leverage");
    // Spot-only exchanges (Coinbase) stay on spot: a SHORT there becomes a sell-what-you-hold guide.
    setMarket(!VENUE_META[v].canShort ? "spot" : side === "SHORT" || lev > 1 ? "perp" : "spot");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setup = useMemo(() => ({
    symbol: (sp.get("symbol") ?? "COIN").toUpperCase(),
    side: (sp.get("side") === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
    entry: hasSetup ? n("entry") : 100,
    entryLow: n("entryLow") || undefined,
    entryHigh: n("entryHigh") || undefined,
    stop: hasSetup ? n("stop") : 95,
    stop2: n("stop2") || undefined,
    tps: hasSetup ? [n("tp1"), n("tp2"), n("tp3")].filter((x) => x > 0) : [105, 110, 120],
    leverage: n("leverage") || 1,
    units: n("units") || undefined,
    notional: n("notional") || undefined,
    riskUsd: n("risk") || undefined,
    balance: n("balance") || undefined,
  }), [sp, hasSetup]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useMemo(() => buildGuide(venue, market, setup), [venue, market, setup]);
  const riskHref = `/risk?${new URLSearchParams({ side: setup.side, entry: String(setup.entry), stop: String(setup.stop), tp1: String(setup.tps[0] ?? ""), tp2: String(setup.tps[1] ?? ""), tp3: String(setup.tps[2] ?? ""), symbol: setup.symbol, leverage: String(setup.leverage) })}`;
  const copy = async () => { try { await navigator.clipboard.writeText(guideToText(g, setup.symbol)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">How to place this trade</h1>
        <p className="text-sm text-fg-2">
          {hasSetup ? <>Step by step for the <b>{setup.symbol} {setup.side}</b> setup: entry {fmtUsd(setup.entry)}, stop {fmtUsd(setup.stop)}{setup.tps.length ? `, targets ${setup.tps.map((t) => fmtUsd(t)).join(" / ")}` : ""}.</> : <>No setup was passed, so the steps use an example (entry $100, stop $95, targets $105 / $110 / $120). Open this page from a setup card or the risk calculator to get your real numbers.</>}
          {" "}AsheSignal never places orders: you do these steps yourself on the exchange.
        </p>
      </div>

      {hasSetup ? <OrderTicket venue={venue} symbol={setup.symbol} side={setup.side} entry={setup.entry} stop={setup.stop} tps={setup.tps} units={setup.units ?? (setup.riskUsd && Math.abs(setup.entry - setup.stop) > 0 ? setup.riskUsd / Math.abs(setup.entry - setup.stop) : null)} leverage={setup.leverage} /> : null}
      <div className="card space-y-3 p-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-3">Exchange</div>
          <div className="flex flex-wrap gap-1.5">
            {VENUE_IDS.map((v) => <button key={v} className="btn-ghost text-xs" data-active={venue === v} onClick={() => { setV(v); setVenue(v); }}>{VENUE_META[v].label}</button>)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-3">Market</div>
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-ghost text-xs" data-active={market === "spot"} onClick={() => setMarket("spot")}>Spot (no leverage)</button>
            <button className="btn-ghost text-xs" data-active={market === "perp"} onClick={() => setMarket("perp")}>Perpetual / margin ({setup.leverage > 1 ? `${setup.leverage}x` : "leverage"})</button>
          </div>
          <p className="mt-1 text-xs text-fg-2">{g.marketNote}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy the whole guide"}</button>
          <Link className="btn-ghost" href={riskHref}>Open in the risk calculator</Link>
          <a className="btn-ghost" href={tradePageUrl(venue, market, setup.symbol)} target="_blank" rel="noreferrer">Open {g.pair} on {VENUE_META[venue].label} ↗</a>
        </div>
      </div>

      {g.sections.map((sec) => (
        <Section key={sec.title} title={sec.title}>
          <ol className="space-y-3">
            {sec.steps.map((st, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint-dim text-xs font-semibold text-mint">{i + 1}</span>
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="font-medium">{st.title}</div>
                  <ul className="space-y-0.5 text-fg-2">{st.body.map((b, j) => <li key={j} className="flex gap-1.5"><span className="text-fg-3">·</span><span className="num-inline">{b}</span></li>)}</ul>
                  {st.warn ? <div className="rounded border border-amber/40 bg-amber-dim px-2 py-1 text-xs text-amber">{st.warn}</div> : null}
                  {st.tip ? <div className="text-xs text-fg-3">Tip: {st.tip}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ))}

      <Section title="Words you will see on the exchange">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {g.glossary.map((x) => <div key={x.term} className="rounded-lg border border-border bg-bg-2 p-2"><dt className="font-medium">{x.term}</dt><dd className="text-xs text-fg-2">{x.meaning}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-fg-3">Exchanges rename buttons now and then; if a name here does not match, look for the same idea (limit order, stop loss, take profit, isolated margin). The full <Link className="link" href="/glossary">glossary</Link> covers every label in AsheSignal.</p>
      </Section>
      <Disclaimer />
    </div>
  );
}
