"use client";

import { useEffect, useMemo, useState } from "react";
import { currentVenue } from "@/lib/venue-pref";
import { squixiSay, setupBriefing } from "@/lib/mascot";
import Link from "next/link";
import { fmtNum, fmtUsd, timeAgo } from "@/lib/format";
import { Disclaimer, Empty, Section, StatCard } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { VENUE_META, isVenueId } from "@/lib/venues";
import JournalAnalytics from "@/components/JournalAnalytics";

interface Suggestion { setupId: string; symbol: string; side: "LONG" | "SHORT"; exchange: string; kind: "fill" | "exit"; price: number; units: number; usd: number; fees: number; fills: number; from: string; to: string; note: string }

interface Row {
  paper?: boolean;
  id: string; asset_key: string; symbol: string; timeframe: string; side: "LONG" | "SHORT"; kind: string;
  entry_low: number; entry_high: number; tp1: number | null; tp2: number | null; tp3: number | null; sl1: number | null; sl2: number | null;
  rr: number | null; leverage: number | null; confidence: number | null; score: number | null; status: string; created_at: string; resolved_at: string | null;
  max_favorable_pct?: number | null; max_adverse_pct?: number | null; last_checked_at?: string | null;
  taken: boolean; taken_at: string | null; exchange: string | null; fill_price: number | null; size_units: number | null; size_usd: number | null; risk_usd: number | null;
  exit_price: number | null; exit_at: string | null; exit_reason: string | null; realized_usd: number | null; realized_r: number | null; fees_usd: number | null; notes: string | null;
}
const STATUSES = ["open", "tp1", "tp2", "tp3", "sl", "closed", "expired"];
const WIN = new Set(["tp1", "tp2", "tp3"]);

export default function SetupsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "ok" | "disabled">("loading");
  const [tab, setTab] = useState<"journal" | "paper" | "saved" | "stats">("journal");
  const [closing, setClosing] = useState<Row | null>(null);
  const [heat, setHeat] = useState<{ level: string; messages: string[]; heatPct: number | null; openCount: number; limits: { maxHeatPct: number; maxOpen: number } } | null>(null);
  useEffect(() => { fetch("/api/me/heat").then((r) => (r.ok ? r.json() : null)).then((j) => setHeat(j?.current ?? null)).catch(() => {}); }, [rows]);
  const [sugg, setSugg] = useState<{ list: Suggestion[]; note?: string; errors?: string[] } | null>(null);
  const [matching, setMatching] = useState(false);
  const match = async () => {
    setMatching(true);
    try { const r = await fetch("/api/me/journal/reconcile"); const j = await r.json(); setSugg({ list: j.suggestions ?? [], note: j.note ?? (j.error ? String(j.error) : undefined), errors: j.errors }); } catch { setSugg({ list: [], note: "Could not reach the server." }); }
    setMatching(false);
  };
  const applySugg = async (x: Suggestion) => {
    if (x.kind === "fill") await patch({ id: x.setupId, fillPrice: x.price, sizeUnits: x.units, sizeUsd: x.usd, feesUsd: x.fees });
    else await patch({ id: x.setupId, exitPrice: x.price, exitReason: "manual", feesUsd: x.fees });
    setSugg((s) => (s ? { ...s, list: s.list.filter((y) => y !== x) } : s));
  };
  const load = async () => {
    const r = await fetch("/api/me/setups");
    if (r.status === 501) return setState("disabled");
    if (r.status === 401) return setState("guest");
    const j = await r.json();
    setRows(j.setups ?? []);
    setState("ok");
  };
  useEffect(() => { load(); }, []);
  const patch = async (body: Record<string, unknown>) => { await fetch("/api/me/setups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); load(); };

  const journal = useMemo(() => (rows ?? []).filter((r) => r.taken && !r.paper), [rows]);
  const paper = useMemo(() => (rows ?? []).filter((r) => r.taken && r.paper), [rows]);
  const saved = useMemo(() => (rows ?? []).filter((r) => !r.taken), [rows]);
  const list = tab === "journal" ? journal : tab === "paper" ? paper : saved;

  const stats = useMemo(() => {
    const src = list;
    const done = src.filter((r) => r.status !== "open");
    const wins = done.filter((r) => WIN.has(r.status) || (r.realized_usd ?? 0) > 0).length;
    const realized = (tab === "paper" ? paper : journal).filter((r) => r.realized_usd != null);
    const pnl = realized.reduce((s, r) => s + (r.realized_usd ?? 0), 0);
    const rsum = realized.reduce((s, r) => s + (r.realized_r ?? 0), 0);
    const risked = journal.filter((r) => r.status === "open").reduce((s, r) => s + (r.risk_usd ?? 0), 0);
    return { total: src.length, open: src.length - done.length, resolved: done.length, winRate: done.length ? Math.round((wins / done.length) * 100) : null, pnl, avgR: realized.length ? +(rsum / realized.length).toFixed(2) : null, risked, closedCount: realized.length };
  }, [list, journal, paper, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Trade journal</h1>
          <p className="text-sm text-fg-2">Trades you actually took (recorded with "I took this trade") and setups you only saved to watch. Both are checked against live price every few minutes; the journal also carries your real fills, sizes and P&L.</p>
        </div>
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost text-xs" data-active={tab === "journal"} onClick={() => setTab("journal")}>Journal ({journal.length})</button>
          <button className="btn-ghost text-xs" data-active={tab === "paper"} onClick={() => setTab("paper")}>Paper ({paper.length})</button>
          <button className="btn-ghost text-xs" data-active={tab === "saved"} onClick={() => setTab("saved")}>Saved only ({saved.length})</button>
          <button className="btn-ghost text-xs" data-active={tab === "stats"} onClick={() => setTab("stats")}>Stats</button>
        </div>
      </div>
      {state === "disabled" ? <Empty>Accounts are not configured on this deployment (see docs/SETUP.md).</Empty> : null}
      {state === "guest" ? <Empty><Link href="/login" className="link">Sign in</Link> to keep a journal. Guest mode does not store trades.</Empty> : null}
      {state === "loading" ? <div className="h-32 animate-pulse rounded-lg bg-bg-3" /> : null}
      {state === "ok" && rows && tab === "stats" ? (
        <Section title="Where your edge is" right={<Link className="link text-xs" href="/track-record">engine track record</Link>}>
          <JournalAnalytics />
          <div className="mt-4 border-t border-border pt-3"><div className="mb-2 text-xs font-semibold text-fg-2">Paper trades</div><JournalAnalytics paper /></div>
        </Section>
      ) : null}
      {state === "ok" && rows && tab !== "stats" ? (
        <>
          <div className="num grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label={tab === "journal" ? "Trades" : "Saved"} value={stats.total} sub={`${stats.open} open`} />
            <StatCard label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "-"} sub={`${stats.resolved} resolved`} />
            {tab === "journal" || tab === "paper" ? <>
              <StatCard label="Realized P&L" value={<span className={stats.pnl >= 0 ? "up" : "down"}>{stats.pnl >= 0 ? "+" : ""}{fmtUsd(stats.pnl)}</span>} sub={`${stats.closedCount} closed with a price`} />
              <StatCard label="Average R" value={stats.avgR != null ? `${stats.avgR > 0 ? "+" : ""}${stats.avgR}R` : "-"} sub="per closed trade" />
              <StatCard label="Money at risk now" value={fmtUsd(stats.risked)} sub="sum of open stops" />
              <StatCard label="Edge check" value={stats.winRate != null && stats.avgR != null ? (stats.avgR > 0 ? "positive" : "negative") : "-"} sub="win rate x average R" />
            </> : null}
          </div>

          {tab === "journal" && heat ? (
            <div className={`rounded-lg border p-3 text-sm ${heat.level === "stop" ? "border-red/50 bg-red/10" : heat.level === "caution" ? "border-amber/40 bg-amber-dim" : "border-mint/40 bg-mint-dim"}`}>
              <div className="flex flex-wrap items-center gap-2"><b>Portfolio heat</b><span className="num text-xs text-fg-2">{heat.heatPct != null ? `${heat.heatPct}% of account at risk` : "set your trading balance on the Risk page to see heat in %"} · {heat.openCount} open · limits {heat.limits.maxHeatPct}% / {heat.limits.maxOpen} trades</span><Link href="/account#limits" className="link ml-auto text-xs">change limits</Link></div>
              <ul className="mt-1 list-disc pl-5 text-xs text-fg-2">{heat.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          ) : null}
          {tab === "journal" ? (
            <div className="card space-y-2 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-ghost" disabled={matching} onClick={match}>{matching ? "Reading exchange fills…" : "Match exchange fills"}</button>
                <span className="text-fg-3">Reads recent trades from your connected exchanges (read-only) and proposes the real fill price, size and exit for open journal trades. You confirm each one.</span>
              </div>
              {sugg ? (
                sugg.list.length ? (
                  <ul className="space-y-1">
                    {sugg.list.map((x, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-border bg-bg-2 p-2">
                        <span className={`pill ${x.kind === "fill" ? "pill-mint" : "pill-gray"}`}>{x.kind === "fill" ? "Fill" : "Exit"}</span>
                        <span className="font-medium">{x.symbol} {x.side}</span>
                        <span className="num text-fg-2">{fmtNum(x.units, 4)} @ {fmtUsd(x.price)} ({fmtUsd(x.usd)}, fees {fmtUsd(x.fees)})</span>
                        <span className="text-fg-3">{x.note}</span>
                        <span className="ml-auto flex gap-1"><button className="btn text-xs" onClick={() => applySugg(x)}>Apply</button><button className="btn-ghost text-xs" onClick={() => setSugg((s) => (s ? { ...s, list: s.list.filter((y) => y !== x) } : s))}>Skip</button></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-fg-3">{sugg.note ?? "Nothing new to match: journal and exchange agree."}</p>
              ) : null}
              {sugg?.errors?.length ? <p className="text-amber">{sugg.errors.join(" · ")}</p> : null}
            </div>
          ) : null}
          <Section title={tab === "journal" ? "Your trades" : tab === "paper" ? "Paper trades (practice, no money)" : "Saved setups (not taken)"} right={list.length ? <button className="btn-ghost text-xs" onClick={() => downloadCsv(`ashesignal-${tab}.csv`, list.map((r) => ({ date: r.created_at, symbol: r.symbol, timeframe: r.timeframe, side: r.side, kind: r.kind, exchange: r.exchange, fill: r.fill_price, size_units: r.size_units, size_usd: r.size_usd, entry_low: r.entry_low, entry_high: r.entry_high, sl1: r.sl1, tp1: r.tp1, tp2: r.tp2, tp3: r.tp3, rr: r.rr, status: r.status, exit_price: r.exit_price, exit_reason: r.exit_reason, realized_usd: r.realized_usd, realized_r: r.realized_r, notes: r.notes })))}>Export CSV</button> : null}>
            {!list.length ? (
              <Empty>{tab === "paper" ? <>No paper trades yet. Tick "Paper trade" in the "I took this trade" dialog to practise without money; results are graded the same way.</> : tab === "journal" ? <>No trades recorded yet. On any setup card or Trading Discovery card press <b>I took this trade</b> after placing it on your exchange.</> : <>No saved setups. Press "Save setup" on any analysis to watch one without taking it.</>}</Empty>
            ) : (
              <div className="space-y-2">
                {list.map((r) => <TradeRow key={r.id} r={r} onPatch={patch} onClose={() => setClosing(r)} onDelete={async () => { await fetch(`/api/me/setups?id=${r.id}`, { method: "DELETE" }); load(); }} />)}
              </div>
            )}
          </Section>
          <p className="text-xs text-fg-3">Status is set automatically from 15-minute candles (first touch of SL1 or a target). For journal trades, press <b>Close at my exit</b> with your real exit price to record the actual P&L; a trade closed on the exchange at the stop or a target is recorded the same way. Exchange fills are never read to place or modify anything.</p>
        </>
      ) : null}
      {closing ? <CloseDialog r={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); load(); }} /> : null}
      <Disclaimer />
    </div>
  );
}

function TradeRow({ r, onPatch, onClose, onDelete }: { r: Row; onPatch: (b: Record<string, unknown>) => Promise<void>; onClose: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(r.notes ?? "");
  const statusTone = WIN.has(r.status) ? "pill-mint" : r.status === "sl" ? "pill-red" : r.status === "open" ? "pill-gray" : "pill-gray";
  const fill = r.fill_price ?? (Number(r.entry_low) + Number(r.entry_high)) / 2;
  const href = r.asset_key.startsWith("cg:") ? `/token/${r.asset_key.slice(3)}?tf=${r.timeframe}` : "/discover";
  return (
    <article className="card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link className="font-semibold hover:text-mint" href={href}>{r.symbol}</Link>
        <span className={`pill ${r.side === "LONG" ? "pill-mint" : "pill-red"}`}>{r.side}</span>
        <span className="pill pill-gray">{r.timeframe}</span>
        <span className={`pill ${r.kind === "confirmed" ? "pill-mint" : "pill-gray"}`}>{r.kind}</span>
        {r.paper ? <span className="pill pill-amber">paper</span> : r.exchange ? <span className="pill pill-gray">{isVenueId(r.exchange) ? VENUE_META[r.exchange].label : r.exchange}</span> : null}
        <span className={`pill ${statusTone}`}>{r.status}</span>
        <button type="button" className="squixi-btn squixi-btn-sm" aria-label="SquixiMutation explains this trade" title="SquixiMutation explains this trade's plan"
          onClick={() => squixiSay(setupBriefing({ symbol: r.symbol, id: r.asset_key.startsWith("cg:") ? r.asset_key.slice(3) : null, tf: r.timeframe, venue: currentVenue(), category: r.kind === "confirmed" ? "confirmed" : null,
            setup: { side: r.side, kind: r.kind, entry: { low: Number(r.entry_low), high: Number(r.entry_high) }, takeProfits: [r.tp1, r.tp2, r.tp3].filter((x): x is number => x != null).map((p, i) => ({ label: `TP${i + 1}`, price: Number(p) })), stopLosses: [r.sl1, r.sl2].filter((x): x is number => x != null).map((p, i) => ({ label: `SL${i + 1}`, price: Number(p) })), rr: r.rr, confidence: r.confidence, leverage: { recommended: r.leverage ?? 1 } } }))}>🦑</button>
        <span className="ml-auto text-xs text-fg-3">{r.taken_at ? `taken ${timeAgo(Date.parse(r.taken_at))}` : `saved ${timeAgo(Date.parse(r.created_at))}`}{r.last_checked_at ? ` · checked ${timeAgo(Date.parse(r.last_checked_at))}` : ""}</span>
      </div>
      <div className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4 lg:grid-cols-6">
        <div><span className="text-fg-3">{r.taken ? "Fill" : "Entry"}</span><div>{r.taken ? fmtUsd(fill) : `${fmtUsd(r.entry_low)} - ${fmtUsd(r.entry_high)}`}</div></div>
        <div><span className="text-fg-3">Stop</span><div className="down">{fmtUsd(r.sl1)}</div></div>
        <div><span className="text-fg-3">Targets</span><div className="up">{fmtUsd(r.tp1)} / {fmtUsd(r.tp2)} / {fmtUsd(r.tp3)}</div></div>
        {r.taken ? <div><span className="text-fg-3">Size</span><div>{r.size_units ? `${fmtNum(r.size_units, 4)} (${fmtUsd(r.size_usd)})` : "-"}</div></div> : <div><span className="text-fg-3">R:R</span><div>{r.rr}R</div></div>}
        {r.taken ? <div><span className="text-fg-3">At risk</span><div className="down">{r.risk_usd ? fmtUsd(r.risk_usd) : "-"}</div></div> : <div><span className="text-fg-3">Confidence</span><div>{r.confidence}%</div></div>}
        <div><span className="text-fg-3">{r.exit_price ? "Result" : "Excursion"}</span><div>{r.exit_price ? <span className={(r.realized_usd ?? 0) >= 0 ? "up" : "down"}>{r.realized_usd != null ? `${r.realized_usd >= 0 ? "+" : ""}${fmtUsd(r.realized_usd)}` : ""} {r.realized_r != null ? `(${r.realized_r > 0 ? "+" : ""}${r.realized_r}R)` : ""}</span> : <span className="text-fg-2">+{r.max_favorable_pct ?? 0}% / -{r.max_adverse_pct ?? 0}%</span>}</div></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {r.taken && !r.exit_price ? <button className="btn" onClick={onClose}>{r.paper ? "Close paper trade" : "Close at my exit"}</button> : null}
        {r.taken && !r.exit_price ? <button className="btn-ghost" title="The order never filled or you changed your mind: the setup goes back to Saved and nothing counts in your stats." onClick={() => onPatch({ id: r.id, taken: false, status: "open" })}>Didn't take it / cancel</button> : null}
        {r.taken && r.exit_price ? <Link className="btn" href={`/card?${new URLSearchParams({ symbol: r.symbol, tf: r.timeframe, side: r.side, entry: String(fill), exit: String(r.exit_price), ...(r.sl1 != null ? { sl: String(r.sl1) } : {}), ...(r.leverage && r.leverage > 1 ? { lev: String(r.leverage) } : {}), ...(r.realized_usd != null ? { usd: String(Math.round(Number(r.realized_usd) * 100) / 100) } : {}), ...(r.taken_at && r.exit_at ? { hours: String(Math.max(1, Math.round((Date.parse(r.exit_at) - Date.parse(r.taken_at)) / 3_600_000))) } : {}) })}`}>🖼 Share result</Link> : null}
        {r.taken && r.exit_price ? <button className="btn-ghost" onClick={() => onPatch({ id: r.id, reopen: true })}>Reopen</button> : null}
        {!r.taken ? <button className="btn-ghost" onClick={() => onPatch({ id: r.id, taken: true })}>Mark as taken</button> : null}
        <label className="flex items-center gap-1 text-fg-3">Status
          <select className="!w-auto !py-1" value={r.status} onChange={(e) => onPatch({ id: r.id, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <button className="btn-ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide notes" : r.notes ? "Notes" : "Add note"}</button>
        <button className="btn-ghost ml-auto" onClick={() => { if (confirm(`Delete ${r.symbol} ${r.side} ${r.timeframe} from the journal? This cannot be undone.`)) onDelete(); }} aria-label="Delete">✕ Delete</button>
      </div>
      {open ? (
        <div className="mt-2 flex gap-2">
          <input className="flex-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why you took it, what you felt, what you learned" />
          <button className="btn-ghost text-xs" onClick={() => onPatch({ id: r.id, notes })}>Save</button>
        </div>
      ) : null}
    </article>
  );
}

function CloseDialog({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(String(r.status === "sl" ? r.sl1 ?? "" : r.status.startsWith("tp") ? r[r.status as "tp1" | "tp2" | "tp3"] ?? "" : ""));
  const [reason, setReason] = useState(r.status === "open" ? "manual" : r.status);
  const [fees, setFees] = useState(r.fees_usd != null ? String(r.fees_usd) : "");
  const [busy, setBusy] = useState(false);
  const fill = r.fill_price ?? (Number(r.entry_low) + Number(r.entry_high)) / 2;
  const p = Number(price);
  const units = r.size_units ?? 0;
  const est = Number.isFinite(p) && p > 0 && units > 0 ? (p - fill) * (r.side === "LONG" ? 1 : -1) * units - (Number(fees) || 0) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold">Close {r.symbol} {r.side} at my exit</div>
        <p className="text-xs text-fg-2">Enter the price you actually exited at on the exchange (the average if you sold in parts). P&L is computed from your recorded fill and size.</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
          <label>Exit price<input inputMode="decimal" className="num" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}>{["tp1", "tp2", "tp3", "sl", "manual", "invalidated"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="col-span-2">Total fees (USD, optional)<input inputMode="decimal" className="num" value={fees} onChange={(e) => setFees(e.target.value)} /></label>
        </div>
        {est != null ? <p className="num text-sm">Result: <b className={est >= 0 ? "up" : "down"}>{est >= 0 ? "+" : ""}{fmtUsd(est)}</b></p> : <p className="text-xs text-fg-3">{units > 0 ? "Enter the exit price." : "No size recorded on this trade; only the R result will be stored."}</p>}
        <div className="flex gap-2">
          <button className="btn text-sm" disabled={busy || !(p > 0)} onClick={async () => { setBusy(true); await fetch("/api/me/setups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, exitPrice: p, exitReason: reason, feesUsd: fees === "" ? undefined : Number(fees) }) }); setBusy(false); onDone(); }}>{busy ? "Saving…" : "Record exit"}</button>
          <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
