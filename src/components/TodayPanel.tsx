"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { currentVenue, VENUE_EVENT } from "@/lib/venue-pref";
import { VENUE_META, type VenueId } from "@/lib/venues";
import { fmtUsd } from "@/lib/format";
import { sharedJson } from "@/lib/shared-fetch";

interface Opp { category: string; side: string | null; venues?: string[]; symbol: string }

/** The six things a trader checks before anything else, in one row. */
export default function TodayPanel() {
  const [venue, setVenue] = useState<VenueId>("binance");
  const [cond, setCond] = useState<{ verdict: string; headline: string } | null>(null);
  const [regime, setRegime] = useState<{ label: string; advice: string } | null>(null);
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [heat, setHeat] = useState<{ level: string; heatPct: number | null; openCount: number } | null | undefined>(undefined);
  const [alerts, setAlerts] = useState<{ unread: number; active: number } | null | undefined>(undefined);
  const [fng, setFng] = useState<{ value: number; label: string } | null>(null);
  // Which tiles have had their answer (or their failure): a tile that got no data says so instead of loading forever.
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const done = (k: string) => () => setSettled((x) => ({ ...x, [k]: true }));
  useEffect(() => {
    setVenue(currentVenue());
    const on = () => setVenue(currentVenue());
    window.addEventListener(VENUE_EVENT, on);
    sharedJson<{ verdict?: string; headline: string }>("/api/conditions", 60_000).then((j) => { if (j?.verdict) setCond({ verdict: j.verdict, headline: j.headline }); }).finally(done("cond"));
    sharedJson<{ label: string; advice: string }>("/api/regime", 60_000).then((j) => { if (j?.label) setRegime(j); }).finally(done("regime"));
    sharedJson<{ items?: Opp[] }>("/api/opportunities?cat=all").then((j) => setOpps(j?.items ?? []));
    fetch("/api/me/heat").then((r) => (r.ok ? r.json() : null)).then((j) => setHeat(j?.current ?? null)).catch(() => setHeat(null));
    fetch("/api/me/alerts").then((r) => (r.ok ? r.json() : null)).then((j) => setAlerts(j ? { unread: (j.events ?? []).filter((e: { read: boolean }) => !e.read).length, active: (j.alerts ?? []).filter((a: { active: boolean }) => a.active).length } : null)).catch(() => setAlerts(null));
    fetch("/api/fng?limit=1").then((r) => (r.ok ? r.json() : null)).then((j) => { const d = j?.data?.[0]; if (d) setFng({ value: Number(d.value), label: d.classification ?? d.label ?? "" }); }).catch(() => {}).finally(done("fng"));
    return () => window.removeEventListener(VENUE_EVENT, on);
  }, []);
  const canShort = VENUE_META[venue].canShort;
  const mine = (opps ?? []).filter((o) => o.category === "confirmed" && o.venues?.includes(venue) && (canShort || o.side === "LONG"));
  const watching = (opps ?? []).filter((o) => o.category === "watching" && o.venues?.includes(venue)).length;
  const tone = (v?: string) => (v === "avoid" || v === "stop" || v === "risk-off" ? "down" : v === "caution" || v === "choppy" || v === "transition" ? "text-amber" : v === "ok" || v === "risk-on" ? "up" : "");
  return (
    <div className="today">
      <Link href="/plan" className="today-tile" style={{ borderColor: "var(--mint)" }}>
        <span className="today-k">Today&apos;s plan</span>
        <span className="today-v up">☀️</span>
        <span className="today-s">stance, what to do with each open trade, setups in zone, risk budget</span>
      </Link>
      <Link href="/glossary#trade-conditions" className="today-tile">
        <span className="today-k">Conditions</span>
        <span className={`today-v ${tone(cond?.verdict)}`}>{cond ? cond.verdict.toUpperCase() : settled.cond ? "n/a" : "…"}</span>
        <span className="today-s">{cond?.headline ?? (settled.cond ? "data unavailable right now; reload in a minute" : "checking news, liquidity, sentiment")}</span>
      </Link>
      <Link href="/glossary#market-regime" className="today-tile">
        <span className="today-k">Regime</span>
        <span className={`today-v ${tone(regime?.label)}`}>{regime?.label ?? (settled.regime ? "n/a" : "…")}</span>
        <span className="today-s">{regime?.advice ?? (settled.regime ? "data unavailable right now; reload in a minute" : "BTC trend, breadth, alt season")}</span>
      </Link>
      <Link href="/opportunities?cat=confirmed" className="today-tile">
        <span className="today-k">Confirmed on {VENUE_META[venue].label}</span>
        <span className="today-v">{opps ? mine.length : "…"}</span>
        <span className="today-s">{opps ? (mine.length ? mine.slice(0, 3).map((o) => `${o.symbol} ${o.side}`).join(", ") + (mine.length > 3 ? "…" : "") : `none right now${canShort ? "" : " (longs only)"}; ${watching} watching`) : "loading"}</span>
      </Link>
      <Link href="/setups" className="today-tile">
        <span className="today-k">My trades</span>
        <span className={`today-v ${heat ? tone(heat.level === "stop" ? "avoid" : heat.level) : ""}`}>{heat === undefined ? "…" : heat ? `${heat.openCount} open` : "sign in"}</span>
        <span className="today-s">{heat ? (heat.heatPct != null ? `${heat.heatPct}% of account at risk` : "set your balance on the Risk page") : "journal, heat, weekly review"}</span>
      </Link>
      <Link href="/alerts" className="today-tile">
        <span className="today-k">Alerts</span>
        <span className="today-v">{alerts === undefined ? "…" : alerts ? alerts.unread : "sign in"}</span>
        <span className="today-s">{alerts ? `unread · ${alerts.active} active rule${alerts.active === 1 ? "" : "s"}` : "price, setup, confirmed-trade alerts"}</span>
      </Link>
      <Link href="/sentiment" className="today-tile">
        <span className="today-k">Fear & Greed</span>
        <span className={`today-v ${fng ? (fng.value <= 25 ? "down" : fng.value >= 75 ? "up" : "") : ""}`}>{fng ? fng.value : settled.fng ? "n/a" : "…"}</span>
        <span className="today-s">{fng?.label ?? (settled.fng ? "data unavailable right now" : "crowd sentiment")}{fng ? (fng.value <= 20 ? " · extremes often mark lows" : fng.value >= 80 ? " · extremes often mark tops" : "") : ""}</span>
      </Link>
    </div>
  );
}
