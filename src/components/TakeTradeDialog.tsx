"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtUsd } from "@/lib/format";
import { currentVenue } from "@/lib/venue-pref";
import { VENUE_IDS, VENUE_META, type VenueId } from "@/lib/venues";
import { supabaseBrowser } from "@/lib/supabase/client";
import PreTradeChecklist from "@/components/PreTradeChecklist";

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
export default function TakeTradeDialog({ setup, symbol, timeframe, assetKey, score, onClose, onSaved }: { setup: TakeSetup; symbol: string; timeframe: string; assetKey?: string; score?: number | null; onClose: () => void; onSaved?: (id: string | null) => void }) {
  const [venue, setVenue] = useState<VenueId>("binance");
  const [fill, setFill] = useState(String(setup.entry.mid));
  const [sizeUsd, setSizeUsd] = useState("");
  const [units, setUnits] = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  const [paper, setPaper] = useState(false);
  const [lev, setLev] = useState(String(setup.leverage?.recommended ?? 1));
  const [verdict, setVerdict] = useState<string | null>(null);
  const needsLevels = !setup.stopLosses.length;
  const [myStop, setMyStop] = useState("");
  const [myTp1, setMyTp1] = useState("");
  const [myTp2, setMyTp2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [guest, setGuest] = useState(false);
  useEffect(() => { const v = currentVenue(); setVenue(v); if (!VENUE_META[v].canShort) setLev("1"); const sb = supabaseBrowser(); if (!sb) setGuest(true); else sb.auth.getUser().then((r) => setGuest(!r.data.user)); }, []);
  const f = num(fill); const u = num(units); const su = num(sizeUsd);
  const L = Math.max(1, Math.min(125, num(lev) || 1));
  const spotOnly = !VENUE_META[venue].canShort && !paper;
  // Money in = margin. Position value = margin x leverage. Units = position value / fill. Everything else
  // (risk, P&L, liquidation) follows from units, so changing leverage re-computes the whole card.
  const onUsd = (v: string, lv = L) => { setSizeUsd(v); if (f > 0) setUnits(num(v) > 0 ? String(+((num(v) * lv) / f).toFixed(6)) : ""); };
  const onUnits = (v: string, lv = L) => { setUnits(v); if (f > 0) setSizeUsd(num(v) > 0 ? String(+((num(v) * f) / lv).toFixed(2)) : ""); };
  const onLev = (v: string) => { setLev(v); const lv = Math.max(1, Math.min(125, num(v) || 1)); if (su > 0) onUsd(sizeUsd, lv); else if (u > 0) onUnits(units, lv); };
  const positionUsd = f > 0 && u > 0 ? f * u : null;
  // Rough isolated-margin liquidation: the move that wipes the margin, less a small maintenance buffer.
  const liq = L > 1 && f > 0 ? (setup.side === "LONG" ? f * (1 - 0.95 / L) : f * (1 + 0.95 / L)) : null;
  const sl = needsLevels ? (num(myStop) || undefined) : setup.stopLosses[0]?.price;
  const riskUsd = f > 0 && u > 0 && sl ? Math.abs(f - sl) * u : null;
  const liqBeforeStop = liq != null && sl != null && (setup.side === "LONG" ? liq >= sl : liq <= sl);
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
      const base = needsLevels ? { ...setup, stopLosses: sl ? [{ price: sl }] : [], takeProfits: [num(myTp1), num(myTp2)].filter((x) => x > 0).map((price) => ({ price })), entry: { low: f, high: f, mid: f } } : setup;
      const effective = { ...base, leverage: { ...(setup.leverage ?? {}), recommended: L, used: L } };
      const r = await fetch("/api/me/setups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setup: { ...effective, riskRewardTp2: rr ?? 0 }, symbol, timeframe, assetKey, score, taken: true, paper, exchange: paper ? "paper" : venue, fillPrice: f || null, sizeUnits: u || null, sizeUsd: positionUsd ? +positionUsd.toFixed(2) : su || null, riskUsd, feesUsd: num(fees) || null, pretradeVerdict: paper ? null : verdict, leverageUsed: L, notes: [notes, L > 1 ? `${L}x leverage, margin ${fmtUsd(su)}` : ""].filter(Boolean).join(" · ") }) });
      if (r.status === 401) { setGuest(true); setBusy(false); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "save failed");
      onSaved?.(j.id ?? null);
      onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose} role="dialog" aria-modal="true" aria-label="Record this trade">
      <div className="card w-full max-w-md space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{paper ? "Paper trade" : "I took this trade"}</div>
            <div className="text-xs text-fg-3">{symbol} {setup.side} · {timeframe}{sl ? ` · stop ${fmtUsd(sl)}` : ""}{setup.takeProfits[0] ? ` · TP1 ${fmtUsd(setup.takeProfits[0].price)}` : ""}</div>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
        </div>
        {guest ? (
          <p className="text-sm text-fg-2">The journal needs an account so your trades are kept and auto-resolved. <Link href="/login" className="link">Sign in</Link> (free), then press this again.</p>
        ) : (
          <>
            {setup.kind === "spot" ? <p className="rounded border border-border bg-bg-2 px-2 py-1 text-xs text-fg-2"><b>Spot purchase.</b> The "stop" here is 15% under the accumulation zone, a review level rather than an order; targets are the profit-taking zones. Status updates come as price reaches them.</p> : null}
            {needsLevels ? <p className="rounded border border-amber/40 bg-amber-dim px-2 py-1 text-xs text-amber"><b>No engine levels for this token</b> (too new, too thin, or no setup). Enter the stop you placed; without a stop the journal cannot measure risk or tell you when you are out.</p> : null}
            {setup.kind !== "confirmed" && setup.kind !== "spot" ? <p className="rounded border border-amber/40 bg-amber-dim px-2 py-1 text-xs text-amber"><b>Not a confirmed setup</b> ({setup.kind}). You can record it, and you should if you placed it, but the journal and the weekly review will count it as a non-confirmed trade.</p> : null}
            <label className="flex items-center gap-2 rounded-lg border border-border bg-bg-2 px-2 py-1.5 text-xs"><input type="checkbox" className="w-auto" checked={paper} onChange={(e) => setPaper(e.target.checked)} /> <span><b>Paper trade</b> (practice, no real money). Tracked and graded exactly like a real trade, kept in its own stats.</span></label>
            <p className="text-xs text-fg-2">Enter what you {paper ? "would do" : "actually did"} on the exchange. The journal then tracks it against live price, tells you when TP or SL is reached, and computes your real P&L. Nothing is sent to the exchange.</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
              <label>Exchange<select value={venue} onChange={(e) => { const v = e.target.value as VenueId; setVenue(v); if (!VENUE_META[v].canShort) onLev("1"); }}>{VENUE_IDS.map((v) => <option key={v} value={v}>{VENUE_META[v].label}</option>)}</select></label>
              <label>Fill price<input inputMode="decimal" className="num" value={fill} onChange={(e) => setFill(e.target.value)} /></label>
              <label>Leverage used{spotOnly ? <input className="num" disabled value="1x (spot)" /> : <span className="flex items-center gap-1"><input inputMode="decimal" className="num" value={lev} onChange={(e) => onLev(e.target.value)} /><span className="text-fg-3">x</span></span>}</label>
              <label>{L > 1 ? "Margin (USD)" : "Size (USD)"}<input inputMode="decimal" className="num" placeholder={L > 1 ? "money you put in" : "e.g. 50"} value={sizeUsd} onChange={(e) => onUsd(e.target.value)} /></label>
              <label>Size (units)<input inputMode="decimal" className="num" value={units} onChange={(e) => onUnits(e.target.value)} /></label>
              {L > 1 ? <label>Position value<input className="num" disabled value={positionUsd ? fmtUsd(positionUsd) : ""} /></label> : null}
              {needsLevels ? <>
                <label>Your stop loss (required)<input inputMode="decimal" className="num" placeholder="price where you are wrong" value={myStop} onChange={(e) => setMyStop(e.target.value)} /></label>
                <label>Your target (optional)<input inputMode="decimal" className="num" placeholder="TP1 price" value={myTp1} onChange={(e) => setMyTp1(e.target.value)} /></label>
                <label>Second target (optional)<input inputMode="decimal" className="num" placeholder="TP2 price" value={myTp2} onChange={(e) => setMyTp2(e.target.value)} /></label>
              </> : null}
              <label>Fees paid (USD, optional)<input inputMode="decimal" className="num" placeholder="0.03" value={fees} onChange={(e) => setFees(e.target.value)} /></label>
              <label className="col-span-2">Notes (why you took it, how you feel)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></label>
            </div>
            {!paper ? <PreTradeChecklist symbol={symbol} side={setup.side} kind={setup.kind} price={f || null} entry={needsLevels ? null : setup.entry} stop={sl ?? null} risk={riskUsd} venue={venue} onVerdict={setVerdict} /> : null}
            {riskUsd != null ? <p className="num text-xs text-fg-2">If the stop hits you lose about <b className="down">{fmtUsd(riskUsd)}</b>{su > 0 ? ` (${Math.round((riskUsd / su) * 100)}% of your ${L > 1 ? "margin" : "stake"})` : ""}; TP2 would pay about <b className="up">{fmtUsd(riskUsd * (rr ?? 0))}</b> ({rr}R).{L > 1 && liq != null ? <> Estimated liquidation near <b className={liqBeforeStop ? "down" : ""}>{fmtUsd(liq)}</b>{liqBeforeStop ? ", which is BEFORE your stop: lower the leverage or the stop never gets to work." : ", beyond your stop, as it should be."}</> : null}</p> : <p className="text-xs text-fg-3">Enter a size to see the money at risk.</p>}
            {setup.leverage?.recommended && L > setup.leverage.recommended ? <p className="rounded border border-amber/40 bg-amber-dim px-2 py-1 text-xs text-amber">You are using more leverage than the engine suggests ({setup.leverage.recommended}x). Leverage changes how fast you lose, not whether the setup is right.</p> : null}
            {heat ? <div className={`rounded border px-2 py-1 text-xs ${heat.level === "stop" ? "border-red/50 bg-red/10 text-red" : heat.level === "caution" ? "border-amber/40 bg-amber-dim text-amber" : "border-border bg-bg-2 text-fg-2"}`}><b>{heat.level === "stop" ? "Over your risk limits with this trade." : heat.level === "caution" ? "Heads up." : "Within limits."}</b> {heat.messages.join(" ")}</div> : null}
            {err ? <p className="text-xs text-red">{err}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="btn text-sm" disabled={busy || !(f > 0) || (needsLevels && !(num(myStop) > 0))} onClick={save}>{busy ? "Saving…" : paper ? "Record paper trade" : "Record in journal"}</button>
              <Link className="btn-ghost text-sm" href={`/guide?${new URLSearchParams({ side: setup.side, entry: String(setup.entry.mid), stop: String(sl ?? ""), tp1: String(setup.takeProfits[0]?.price ?? ""), tp2: String(setup.takeProfits[1]?.price ?? ""), tp3: String(setup.takeProfits[2]?.price ?? ""), symbol, leverage: String(L), venue, units: u > 0 ? String(u) : "" })}`}>How to place it</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
