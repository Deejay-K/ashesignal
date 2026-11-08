"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VENUE_IDS, VENUE_META } from "@/lib/venues";
import { ALERT_TYPES } from "@/lib/alerts/types";
import { TIMEFRAMES } from "@/lib/types";
import { Disclaimer, Empty, Section } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface AlertRow { id: string; symbol: string; type: string; timeframe: string | null; params: Record<string, string | number>; channels?: string[]; active: boolean; last_fired_at: string | null; created_at: string; asset_key: string }
interface EventRow { id: string; symbol: string; title: string; body: string; url: string | null; fired_at: string; read: boolean }

export default function AlertsPage() {
  return <Suspense><Alerts /></Suspense>;
}

function Alerts() {
  const sp = useSearchParams();
  const [state, setState] = useState<"loading" | "guest" | "disabled" | "ok">("loading");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [form, setForm] = useState({ side: "", venue: "", ctf: "", minConf: "", symbol: sp.get("symbol") ?? "", id: sp.get("id") ?? (sp.get("asset")?.startsWith("cg:") ? sp.get("asset")!.slice(3) : ""), address: sp.get("address") ?? "", type: sp.get("type") ?? (sp.get("address") ? "liquidity_change" : "price_above"), timeframe: sp.get("tf") ?? "1h", price: sp.get("price") ?? "", pct: sp.get("address") ? "30" : "5", bars: "24", rsi: "70", ratio: "2", zone: "Extreme Fear", chain: "", cooldown: "60", usd: "100000", push: true, email: false });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetch("/api/me/alerts");
    if (r.status === 501) return setState("disabled");
    if (r.status === 401) return setState("guest");
    const j = await r.json();
    setAlerts(j.alerts ?? []);
    setEvents(j.events ?? []);
    setState("ok");
    if (j.events?.some((e: EventRow) => !e.read)) fetch("/api/me/alerts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "-", markRead: true }) });
  };
  useEffect(() => { load(); }, []);

  const def = ALERT_TYPES.find((t) => t.type === form.type)!;
  const needs = (k: string) => (def.params as readonly string[]).includes(k);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const params: Record<string, string | number> = {};
    for (const p of def.params) params[p] = p === "zone" ? form.zone : Number(form[p as keyof typeof form]);
    if (form.type === "new_listing" && form.chain) params.chain = form.chain;
    if (form.type === "whale_transfer") params.usd = Number(form.usd);
    if (form.type === "new_confirmed") { if (form.side) params.side = form.side; if (form.venue) params.venue = form.venue; if (form.ctf) params.tf = form.ctf; if (form.minConf) params.minConf = Number(form.minConf); }
    const channels = [form.push ? "push" : "", form.email ? "email" : ""].filter(Boolean);
    const r = await fetch("/api/me/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: form.symbol || (form.type === "new_listing" ? "LISTINGS" : form.type === "macro_event" ? "MACRO" : form.type === "new_confirmed" ? "CONFIRMED" : form.type === "trade_update" ? "JOURNAL" : form.type === "whale_transfer" ? "WHALE" : "MARKET"), assetKey: form.address ? `addr:${form.address}` : form.id ? `cg:${form.id}` : `sym:${form.symbol.toUpperCase()}`, assetRef: { symbol: form.symbol.toUpperCase(), id: form.id || undefined, address: form.address || undefined }, type: form.type, timeframe: form.timeframe, params, channels, cooldownMinutes: Number(form.type === "new_listing" ? Math.max(60, Number(form.cooldown)) : form.cooldown) }) });
    if (!r.ok) return setErr((await r.json()).error);
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Alerts</h1>
        <p className="text-sm text-fg-2">Edge-triggered rules evaluated every few minutes by the worker (see SETUP.md step 5). Delivered by push, email and the inbox below.</p>
      </div>
      {state === "disabled" ? <Empty>Accounts are not configured (docs/SETUP.md step 3).</Empty> : null}
      {state === "guest" ? <Empty><Link href="/login" className="link">Sign in</Link> to create alerts.</Empty> : null}
      {state === "ok" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="New alert">
            <form className="space-y-2 text-xs text-fg-3" onSubmit={submit}>
              <label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{ALERT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
              {form.type === "whale_transfer" ? <><label>Token contract address<input className="num" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x... or Solana mint" /></label><label>Minimum transfer $<input type="number" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} /></label></> : null}
              {form.type === "liquidity_change" ? <label>Token contract address<input className="num" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x… or Solana mint" /></label> : null}
              {form.type === "new_confirmed" ? (
                <div className="space-y-2 rounded-lg border border-mint/40 bg-mint-dim p-2">
                  <p className="text-fg-2">Fires when a coin enters Confirmed Trades. Leave filters empty for everything, or narrow it to what you can actually trade.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label>Direction<select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option value="">Both</option><option value="LONG">Longs only</option><option value="SHORT">Shorts only</option></select></label>
                    <label>Listed on<select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}><option value="">Any exchange</option>{VENUE_IDS.map((v) => <option key={v} value={v}>{VENUE_META[v].label}{!VENUE_META[v].canShort ? " (longs only)" : ""}</option>)}</select></label>
                    <label>Timeframe<select value={form.ctf} onChange={(e) => setForm({ ...form, ctf: e.target.value })}><option value="">Any</option>{["1h", "4h", "1d"].map((t) => <option key={t}>{t}</option>)}</select></label>
                    <label>Min confidence<input type="number" placeholder="e.g. 70" value={form.minConf} onChange={(e) => setForm({ ...form, minConf: e.target.value })} /></label>
                  </div>
                </div>
              ) : null}
              {form.type === "spot_zone" ? <p className="rounded-lg border border-border bg-bg-2 p-2 text-fg-2">Enter the coin above. Fires when its price enters the accumulation zone computed on the Spot Investments card (the coin must currently be a Spot pick).</p> : null}
              {form.type === "trade_update" ? <p className="rounded-lg border border-border bg-bg-2 p-2 text-fg-2">Created automatically for every trade you record in the journal: you are notified when it reaches TP1, TP2, TP3 or the stop. Nothing to configure.</p> : null}
              {form.type === "new_listing" ? <label>Chain filter (optional)<input value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} placeholder="solana, base, ethereum… blank = all" /></label> : null}
              {form.type !== "sentiment_zone" && form.type !== "new_listing" && form.type !== "macro_event" && form.type !== "whale_transfer" && form.type !== "liquidity_change" && form.type !== "new_confirmed" && form.type !== "trade_update" && form.type !== "spot_zone" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label>Ticker<input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="BTC" required /></label>
                    <label>CoinGecko id (optional)<input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="bitcoin" /></label>
                  </div>
                  <label>Timeframe<select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select></label>
                </>
              ) : null}
              {needs("price") ? <label>Price $<input type="number" step="any" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label> : null}
              {needs("pct") ? <div className="grid grid-cols-2 gap-2"><label>Move %<input type="number" step="any" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} /></label><label>Within hours<input type="number" value={form.bars} onChange={(e) => setForm({ ...form, bars: e.target.value })} /></label></div> : null}
              {needs("rsi") ? <label>RSI level<input type="number" value={form.rsi} onChange={(e) => setForm({ ...form, rsi: e.target.value })} /></label> : null}
              {needs("ratio") ? <label>Volume multiple ×<input type="number" step="any" value={form.ratio} onChange={(e) => setForm({ ...form, ratio: e.target.value })} /></label> : null}
              {needs("zone") ? <label>Zone<select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>{["Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"].map((z) => <option key={z}>{z}</option>)}</select></label> : null}
              <label>Cooldown (minutes)<input type="number" value={form.cooldown} onChange={(e) => setForm({ ...form, cooldown: e.target.value })} /></label>
              <div className="flex flex-wrap gap-3 text-xs"><span className="text-fg-3">Deliver via:</span><label className="flex items-center gap-1"><input type="checkbox" className="w-auto" checked={form.push} onChange={(e) => setForm({ ...form, push: e.target.checked })} /> push</label><label className="flex items-center gap-1"><input type="checkbox" className="w-auto" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} /> email</label><span className="text-fg-3">+ inbox always</span></div>
              <button className="btn w-full text-sm">Create alert</button>
              {err ? <p className="text-red">{err}</p> : null}
            </form>
          </Section>
          <Section title={`Active rules (${alerts.length})`}>
            {alerts.length ? (
              <ul className="divide-y divide-border text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                    <b>{a.symbol}</b>
                    <span className="text-fg-2">{ALERT_TYPES.find((t) => t.type === a.type)?.label ?? a.type}</span>
                    <span className="num text-xs text-fg-3">{Object.entries(a.params).map(([k, v]) => `${k}=${v}`).join(" ")} · {a.timeframe}</span>
                    {a.channels?.length ? <span className="pill pill-gray">{a.channels.join("+")}</span> : null}
                    {a.last_fired_at ? <span className="pill pill-mint">fired {timeAgo(new Date(a.last_fired_at).getTime())}</span> : null}
                    <span className="ml-auto flex gap-1">
                      <button className="btn-ghost" data-active={a.active} onClick={async () => { await fetch("/api/me/alerts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: a.id, active: !a.active }) }); load(); }}>{a.active ? "on" : "off"}</button>
                      <button className="btn-ghost" onClick={async () => { await fetch(`/api/me/alerts?id=${a.id}`, { method: "DELETE" }); load(); }}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No alerts yet.</Empty>}
          </Section>
          <Section title="Inbox">
            {events.length ? (
              <ul className="divide-y divide-border text-sm">
                {events.map((e) => (
                  <li key={e.id} className={`py-2 ${e.read ? "" : "bg-mint-dim/40 -mx-2 rounded px-2"}`}>
                    <div className="flex items-center gap-2"><b>{e.title}</b><span className="ml-auto text-xs text-fg-3">{timeAgo(new Date(e.fired_at).getTime())}</span></div>
                    <p className="text-fg-2">{e.body}</p>
                    {e.url ? <Link href={e.url} className="link text-xs">open →</Link> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing fired yet.</Empty>}
          </Section>
        </div>
      ) : null}
      <Disclaimer />
    </div>
  );
}
