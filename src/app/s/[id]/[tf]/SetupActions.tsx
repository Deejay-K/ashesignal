"use client";

import { useState } from "react";
import Link from "next/link";
import TakeTradeDialog from "@/components/TakeTradeDialog";
import ZoneBadge from "@/components/ZoneBadge";
import ConfirmAlertButton from "@/components/ConfirmAlertButton";
import { fmtUsd } from "@/lib/format";
import { VENUE_META, type VenueId } from "@/lib/venues";
import type { Setup } from "@/lib/ta/analysis";

/** Action row of the shareable setup page: record, copy, size, guide, exchange, alerts. */
export default function SetupActions({ coin, tf, setup: s, venue, tradeUrl }: { coin: { id: string; symbol: string; name: string }; tf: string; setup: Setup; venue: VenueId; tradeUrl: string | null }) {
  const [taking, setTaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const vm = VENUE_META[venue];
  const copy = async () => {
    const txt = [`${coin.symbol} ${s.side} ${tf} - ${s.kind} - AsheSignal`, `Pair on ${vm.label}: ${vm.instrument(coin.symbol, vm.quotes[0])}`, `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`, ...s.takeProfits.map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`), ...s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`), `Leverage: ${s.leverage.recommended}x (max ${s.leverage.maxSafe}x)`, `Sizing: risk 1% of account between entry and SL1`, `Manual trading only. Not financial advice.`].join("\n");
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const q = new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0]?.price ?? ""), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), symbol: coin.symbol, tf, leverage: String(s.leverage.recommended), venue });
  return (
    <div className="card space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {recorded ? <span className="pill pill-mint">Recorded in journal</span> : <button className={s.kind === "confirmed" ? "btn" : "btn-ghost"} onClick={() => setTaking(true)}>I took this trade</button>}
        <button className="btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy Trade Setup"}</button>
        <Link className="btn-ghost" href={`/risk?${q}`}>Size it</Link>
        <Link className="btn-ghost" href={`/guide?${q}`}>How to place it</Link>
        {tradeUrl ? <a className="btn-ghost" href={tradeUrl} target="_blank" rel="noreferrer">Open on exchange ↗</a> : null}
        <Link className="btn-ghost" href={`/token/${coin.id}?tf=${tf}`}>Full analysis</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <ZoneBadge price={null} entry={s.entry} side={s.side} symbol={coin.symbol} assetKey={`cg:${coin.id}`} timeframe={tf} />
        {s.kind !== "confirmed" ? <ConfirmAlertButton symbol={coin.symbol} coingeckoId={coin.id} /> : null}
      </div>
      {taking ? <TakeTradeDialog setup={s} symbol={coin.symbol} timeframe={tf} assetKey={`cg:${coin.id}`} score={null} onClose={() => setTaking(false)} onSaved={() => setRecorded(true)} /> : null}
    </div>
  );
}
