"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtUsd } from "@/lib/format";
import { currentVenue } from "@/lib/venue-pref";
import { VENUE_IDS, VENUE_META, type VenueId } from "@/lib/venues";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Minimal setup shape the dialog needs (works for engine Setup and discovery detail.setup). */
export interface TakeSetup {
  side: "LONG" | "SHORT";
  kind: string;
  entry: { low: number; high: number; mid: number };
  takeProfits: { price: number }[];
  stopLosses: { price: number }[];
  riskRewardTp2?: number;
  rr?: number;
  confidence: number;
  leverage?: { recommended: number } | null;
}

const num = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : 0; };

/**
 * "I took this trade": records the real fill, size and exchange on a saved setup so the journal can
 * track it against live price and compute real P&L. Nothing is sent to any exchange.
 */
export default function TakeTradeDialog({ setup, symbol, timeframe, assetKey, score, onClose, onSaved }: { setup: TakeSetup; symbol: string; timeframe: string; assetKey?: string; score?: number | null; onClose: () => void; onSaved?: () => void }) {
  const [venue, setVenue] = useState<VenueId>("binance");
  const [fill, setFill] = useState(String(setup.entry.mid));
  const [sizeUsd, setSizeUsd] = useState("");
  const [units, setUnits] = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [guest, setGuest] = useState(false);
  useEffect(() => { setVenue(currentVenue()); const sb = supabaseBrowser(); if (!sb) setGuest(true); else sb.auth.getUser().then((r) => setGuest(!r.data.user)); }, []);
  const f = num(fill); const u = num(units); const su = num(sizeUsd);
  // keep units and dollars in sync whichever one is typed
  const onUsd = (v: string) => { setSizeUsd(v); if (f > 0) setUnits(num(v) > 0 ? String(+(num(v) / f).toFixed(6)) : ""); };
  const onUnits = (v: string) => { setUnits(v); if (f > 0) setSizeUsd(num(v) > 0 ? String(+(num(v) * f).toFixed(2)) : ""); };
  const sl = setup.stopLosses[0]?.price;
  const riskUsd = f > 0 && u > 0 && sl ? Math.abs(f - sl) * u : null;
  const rr = setup.riskRewardTp2 ?? setup.rr;
  const [heat, setHeat] = useState<{ level: string; messages: string[] } | null>(null);
  useEffect(() => {
    if (guest || riskUsd == null) { setHeat(null); return; }
    const t = setTimeout(() => fetch(`/api/me/heat?symbol=${encodeURIComponent(symbol)}&side=${setup.side}&risk=${riskUsd}`).then((r) => (r.ok ? r.json() : null)).then((j) => setHeat(j?.preview ?? null)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [riskUsd, guest, symbol, setup.side]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/me/setups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setup: { ...setup, riskRewardTp2: rr ?? 0 }, symbol, timeframe, assetKey, score, taken: true, exchange: venue, fillPrice: f || null, sizeUnits: u || null, sizeUsd: su || null, riskUsd, feesUsd: num(fees) || null, notes }) });
      if (r.status === 401) { setGuest(true); setBusy(false); return; }
      if (!r.ok) throw new Error((await r.json()).error ?? "save failed");
      onSaved?.();
      onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose} role="dialog" aria-modal="true" aria-label="Record this trade">
      <div className="card w-full max-w-md space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">I took this trade</div>
            <div className="text-xs text-fg-3">{symbol} {setup.side} · {timeframe} · stop {fmtUsd(sl)} · TP1 {fmtUsd(setup.takeProfits[0]?.price)}</div>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
        </div>
        {guest ? (
          <p className="text-sm text-fg-2">The journal needs an account so your trades are kept and auto-resolved. <Link href="/login" className="link">Sign in</Link> (free), then press this again.</p>
        ) : (
          <>
            {setup.kind === "spot" ? <p className="rounded border border-border bg-bg-2 px-2 py-1 text-xs text-fg-2"><b>Spot purchase.</b> The "stop" here is 15% under the accumulation zone, a review level rather than an order; targets are the profit-taking zones. Status updates come as price reaches them.</p> : null}
            {setup.kind !== "confirmed" && setup.kind !== "spot" ? <p className="rounded border border-amber/40 bg-amber-dim px-2 py-1 text-xs text-amber"><b>Not a confirmed setup</b> ({setup.kind}). You can record it, and you should if you placed it, but the journal and the weekly review will count it as a non-confirmed trade.</p> : null}
            <p className="text-xs text-fg-2">Enter what you actually did on the exchange. The journal then tracks it against live price, tells you when TP or SL is reached, and computes your real P&L. Nothing is sent to the exchange.</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
              <label>Exchange<select value={venue} onChange={(e) => setVenue(e.target.value as VenueId)}>{VENUE_IDS.map((v) => <option key={v} value={v}>{VENUE_META[v].label}</option>)}</select></label>
              <label>Fill price<input inputMode="decimal" className="num" value={fill} onChange={(e) => setFill(e.target.value)} /></label>
              <label>Size (USD)<input inputMode="decimal" className="num" placeholder="e.g. 50" value={sizeUsd} onChange={(e) => onUsd(e.target.value)} /></label>
              <label>Size (units)<input inputMode="decimal" className="num" value={units} onChange={(e) => onUnits(e.target.value)} /></label>
              <label>Fees paid (USD, optional)<input inputMode="decimal" className="num" placeholder="0.03" value={fees} onChange={(e) => setFees(e.target.value)} /></label>
              <label>Leverage used<input className="num" disabled value={`${setup.leverage?.recommended ?? 1}x recommended`} /></label>
              <label className="col-span-2">Notes (why you took it, how you feel)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></label>
            </div>
            {riskUsd != null ? <p className="num text-xs text-fg-2">If the stop hits you lose about <b className="down">{fmtUsd(riskUsd)}</b>; TP2 would pay about <b className="up">{fmtUsd(riskUsd * (rr ?? 0))}</b> ({rr}R).</p> : <p className="text-xs text-fg-3">Enter a size to see the money at risk.</p>}
            {heat ? <div className={`rounded border px-2 py-1 text-xs ${heat.level === "stop" ? "border-red/50 bg-red/10 text-red" : heat.level === "caution" ? "border-amber/40 bg-amber-dim text-amber" : "border-border bg-bg-2 text-fg-2"}`}><b>{heat.level === "stop" ? "Over your risk limits with this trade." : heat.level === "caution" ? "Heads up." : "Within limits."}</b> {heat.messages.join(" ")}</div> : null}
            {err ? <p className="text-xs text-red">{err}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="btn text-sm" disabled={busy || !(f > 0)} onClick={save}>{busy ? "Saving…" : "Record in journal"}</button>
              <Link className="btn-ghost text-sm" href={`/guide?${new URLSearchParams({ side: setup.side, entry: String(setup.entry.mid), stop: String(sl ?? ""), tp1: String(setup.takeProfits[0]?.price ?? ""), tp2: String(setup.takeProfits[1]?.price ?? ""), tp3: String(setup.takeProfits[2]?.price ?? ""), symbol, leverage: String(setup.leverage?.recommended ?? 1), venue })}`}>How to place it</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
