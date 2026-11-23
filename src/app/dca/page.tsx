"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { fmtUsd, fmtNum } from "@/lib/format";
import type { DcaPlan } from "@/lib/dca";

type Res = DcaPlan & { coingeckoId: string; name: string };

/** DCA planner: split a spot buy into limit orders across the buy zone. */
function DcaInner() {
  const sp = useSearchParams();
  const [symbol, setSymbol] = useState(sp.get("symbol") ?? "BTC");
  const [budget, setBudget] = useState(sp.get("budget") ?? "200");
  const [count, setCount] = useState("4");
  const [weighting, setWeighting] = useState<"even" | "heavier-low">("even");
  const [low, setLow] = useState(""); const [high, setHigh] = useState("");
  const [r, setR] = useState<Res | null | undefined>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setR(undefined); setErr(null);
    const q = new URLSearchParams({ symbol, budget, count, weighting }); if (low && high) { q.set("low", low); q.set("high", high); }
    const res = await fetch(`/api/dca?${q}`); const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? "failed"); setR(null); return; }
    setR(j);
  };
  useEffect(() => { if (sp.get("symbol")) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">DCA planner</h1>
        <p className="text-sm text-fg-2">Split a spot buy into limit orders across the buy zone instead of one entry. The zone comes from the coin&apos;s spot pick (accumulation zone) or its daily supports; you can set your own.</p>
      </div>
      <div className="card grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4">
        <label>Coin<input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="BTC" /></label>
        <label>Budget ($)<input inputMode="decimal" className="num" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        <label>Number of orders<select value={count} onChange={(e) => setCount(e.target.value)}>{[2, 3, 4, 5, 6, 8].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>Sizing<select value={weighting} onChange={(e) => setWeighting(e.target.value as "even" | "heavier-low")}><option value="even">Equal orders</option><option value="heavier-low">Bigger orders lower</option></select></label>
        <label>Custom zone low (optional)<input inputMode="decimal" className="num" value={low} onChange={(e) => setLow(e.target.value)} /></label>
        <label>Custom zone high (optional)<input inputMode="decimal" className="num" value={high} onChange={(e) => setHigh(e.target.value)} /></label>
        <div className="col-span-2 flex items-end"><button className="btn" onClick={run}>Build plan</button></div>
      </div>
      {err ? <p className="text-sm text-red">{err}</p> : null}
      {r === undefined ? <div className="skeleton h-40" /> : r ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label={`${r.symbol} now`} value={fmtUsd(r.price)} sub={r.name} />
            <StatCard label="Buy zone" value={fmtUsd(r.zone.low)} sub={<>up to {fmtUsd(r.zone.high)}<br />{r.zoneSource}</>} />
            <StatCard label="Average if all fill" value={fmtUsd(r.avgIfAll)} sub={`${fmtNum(r.unitsIfAll, 6)} ${r.symbol}`} />
            <StatCard label="Review level" value={fmtUsd(r.reviewLevel)} sub="stop buying below this" />
          </div>
          <Section title="Orders to place (limit buys, good till cancelled)">
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th>#</th><th className="text-right">Limit price</th><th className="text-right">Dollars</th><th className="text-right">{r.symbol}</th><th className="text-right">Avg if filled to here</th></tr></thead><tbody>
              {r.orders.map((o, i) => <tr key={o.n} className="border-t border-border"><td className="py-1">{o.n}</td><td className="num text-right">{fmtUsd(o.price)}</td><td className="num text-right">{fmtUsd(o.usd)}</td><td className="num text-right">{fmtNum(o.units, 6)}</td><td className="num text-right">{fmtUsd(r.partial[i].avg)}</td></tr>)}
            </tbody></table></div>
          </Section>
          {r.takeProfit.length ? <Section title="Where to take profit later"><ul className="text-sm">{r.takeProfit.map((t) => <li key={t.label} className="flex justify-between border-b border-border py-1 last:border-0"><span>{t.label}</span><span className="num">{fmtUsd(t.price)}</span></li>)}</ul></Section> : null}
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{[...r.notes, r.reviewNote].map((n, i) => <li key={i}>{n}</li>)}</ul>
          <p className="text-xs text-fg-3"><Link className="link" href={`/token/${r.coingeckoId}?tf=1d`}>{r.symbol} analysis</Link> · <Link className="link" href="/opportunities?cat=spot">Spot investments</Link> · <Link className="link" href="/learn/spot-coinbase">How spot works on Coinbase</Link></p>
        </>
      ) : null}
      <Disclaimer />
    </div>
  );
}
export default function DcaPage() { return <Suspense fallback={<div className="skeleton h-40" />}><DcaInner /></Suspense>; }
