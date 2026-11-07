"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ALERT_TYPES } from "@/lib/alerts/types";
import { TIMEFRAMES } from "@/lib/types";
import { Disclaimer, Empty, Section } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface AlertRow { id: string; symbol: string; type: string; timeframe: string | null; params: Record<string, string | number>; active: boolean; last_fired_at: string | null; created_at: string; asset_key: string }
interface EventRow { id: string; symbol: string; title: string; body: string; url: string | null; fired_at: string; read: boolean }

export default function AlertsPage() {
  return <Suspense><Alerts /></Suspense>;
}

function Alerts() {
  const sp = useSearchParams();
  const [state, setState] = useState<"loading" | "guest" | "disabled" | "ok">("loading");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [form, setForm] = useState({ symbol: sp.get("symbol") ?? "", id: sp.get("id") ?? "", type: "price_above", timeframe: sp.get("tf") ?? "1h", price: sp.get("price") ?? "", pct: "5", bars: "24", rsi: "70", ratio: "2", zone: "Extreme Fear", cooldown: "60" });
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
    const r = await fetch("/api/me/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: form.symbol || "MARKET", assetKey: form.id ? `cg:${form.id}` : `sym:${form.symbol.toUpperCase()}`, assetRef: { symbol: form.symbol.toUpperCase(), id: form.id || undefined }, type: form.type, timeframe: form.timeframe, params, cooldownMinutes: Number(form.cooldown) }) });
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
              {form.type !== "sentiment_zone" ? (
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
