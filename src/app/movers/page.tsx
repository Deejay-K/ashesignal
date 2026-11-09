"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Section } from "@/components/ui";
import { fmtUsd, timeAgo } from "@/lib/format";
import { VENUE_EVENT } from "@/lib/venue-pref";
import type { Movers, Mover } from "@/lib/movers";

/** Market movers: gainers, losers, volume spikes, and what confirmed or lost confirmation in the last 24 hours. */
export default function MoversPage() {
  const [m, setM] = useState<Movers | null | undefined>(undefined);
  const [onlyMine, setOnlyMine] = useState(false);
  const load = () => fetch("/api/movers").then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null));
  useEffect(() => { load(); const h = () => load(); window.addEventListener(VENUE_EVENT, h); return () => window.removeEventListener(VENUE_EVENT, h); }, []);
  if (m === undefined) return <div className="space-y-3"><div className="skeleton h-8 w-48" /><div className="skeleton h-64" /></div>;
  if (!m) return <p className="text-sm text-red">Movers unavailable right now.</p>;
  const f = <T extends { listed: boolean }>(xs: T[]) => (onlyMine ? xs.filter((x) => x.listed) : xs);
  const List = ({ rows }: { rows: Mover[] }) => (
    <ul className="text-sm">{f(rows).map((r) => (
      <li key={r.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-0">
        <Link href={`/token/${r.id}`} className="font-medium hover:text-mint">{r.symbol}</Link>
        {r.listed ? <span className="pill pill-gray text-[10px]">on your exchange</span> : null}
        <span className="num ml-auto text-fg-2">{fmtUsd(r.price)}</span>
        <span className={`num w-16 text-right ${(r.change24h ?? 0) >= 0 ? "up" : "down"}`}>{(r.change24h ?? 0) >= 0 ? "+" : ""}{(r.change24h ?? 0).toFixed(1)}%</span>
      </li>))}</ul>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Market movers</h1>
          <p className="text-sm text-fg-2">Coins over 50M market cap, last 24 hours.{m.breadth ? ` ${m.breadth.up} up, ${m.breadth.down} down of ${m.breadth.total}.` : ""} A big move is information, not a signal: check the setup before acting.</p>
        </div>
        <button type="button" className={`btn-ghost !py-1 text-xs ${onlyMine ? "!border-mint !text-mint" : ""}`} onClick={() => setOnlyMine(!onlyMine)}>{onlyMine ? "✓ " : ""}Only coins on my exchange</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Top gainers"><List rows={m.gainers} /></Section>
        <Section title="Top losers"><List rows={m.losers} /></Section>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Section title="Volume spikes (4h)">{f(m.volume).length ? <ul className="text-sm">{f(m.volume).map((v) => <li key={v.symbol} className="flex justify-between border-b border-border py-1 last:border-0">{v.coingeckoId ? <Link className="hover:text-mint" href={`/token/${v.coingeckoId}`}>{v.symbol}</Link> : v.symbol}<span className="num text-fg-2">{v.ratio}x · {v.outlook}</span></li>)}</ul> : <p className="text-xs text-fg-3">No coin is trading at 2x its usual volume.</p>}</Section>
        <Section title="Newly confirmed (24h)">{f(m.confirmedNew).length ? <ul className="text-sm">{f(m.confirmedNew).map((c, i) => <li key={i} className="flex justify-between border-b border-border py-1 last:border-0">{c.coingeckoId ? <Link className="hover:text-mint" href={`/s/${c.coingeckoId}/${c.timeframe}`}>{c.symbol} {c.side ?? ""} {c.timeframe}</Link> : `${c.symbol} ${c.timeframe}`}<span className="text-xs text-fg-3">{timeAgo(Date.parse(c.at))}</span></li>)}</ul> : <p className="text-xs text-fg-3">Nothing confirmed in the last day.</p>}</Section>
        <Section title="Lost confirmation (24h)">{m.confirmedLost.length ? <ul className="text-sm">{m.confirmedLost.map((c, i) => <li key={i} className="border-b border-border py-1 last:border-0"><div className="flex justify-between"><span>{c.symbol} {c.timeframe}</span><span className="text-xs text-fg-3">{timeAgo(Date.parse(c.at))}</span></div>{c.reason ? <div className="text-xs text-fg-3">{c.reason}</div> : null}</li>)}</ul> : <p className="text-xs text-fg-3">No confirmed setup was lost.</p>}</Section>
      </div>
      <Disclaimer />
    </div>
  );
}
