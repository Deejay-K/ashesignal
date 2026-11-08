"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { VENUE_COOKIE } from "@/lib/venue-pref";

const KEY = "ashesignal.onboarding.dismissed";

interface Step { id: string; title: string; why: string; href: string; done: boolean }

/** First-run checklist. Each step is detected automatically; the card disappears when all are done or dismissed. */
export default function GettingStarted() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    (async () => {
      let dismissed = false;
      try { dismissed = !!localStorage.getItem(KEY); } catch {}
      if (dismissed) return;
      const sb = supabaseBrowser();
      const user = sb ? (await sb.auth.getUser()).data.user : null;
      let venue = false; try { venue = /as_venue=/.test(document.cookie) || !!localStorage.getItem(VENUE_COOKIE); } catch {}
      let risk = false; try { risk = !!localStorage.getItem("ashesignal.risk.profile.v1"); } catch {}
      let alerts = false, journal = false, digest = false;
      if (user) {
        const [a, s, p] = await Promise.all([fetch("/api/me/alerts").then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch("/api/me/setups").then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
        alerts = !!a?.alerts?.length;
        journal = !!s?.setups?.some((x: { taken: boolean }) => x.taken);
        digest = !!p?.profile?.digest_enabled;
        risk = risk || !!p?.profile?.trading_balance;
      }
      const list: Step[] = [
        { id: "venue", title: "Choose your exchange", why: "Charts, Discover and every trade link follow it; Coinbase means longs only.", href: "/account", done: venue },
        { id: "risk", title: "Set your balance and risk per trade", why: "The calculator sizes every trade from these two numbers. 1% is the standard.", href: "/risk", done: risk },
        { id: "account", title: "Sign in (free)", why: "Keeps your journal, alerts and watchlist across devices.", href: "/login", done: !!user },
        { id: "alert", title: "Turn on one alert", why: "\"New Confirmed Trade on my exchange\" means you stop refreshing the page.", href: "/alerts", done: alerts },
        { id: "digest", title: "Turn on the daily digest", why: "One message a day: conditions, confirmed trades you can place, your open trades.", href: "/account", done: digest },
        { id: "journal", title: "Record your first trade", why: "Press \"I took this trade\" after placing it; your real win rate starts here.", href: "/opportunities?cat=confirmed", done: journal },
      ];
      setSteps(list);
      setHidden(list.every((s) => s.done));
    })();
  }, []);
  if (hidden || !steps) return null;
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="card relative border-l-4 border-mint p-4">
      <button className="absolute right-3 top-2 text-fg-3 hover:text-fg" aria-label="Dismiss" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setHidden(true); }}>×</button>
      <div className="flex flex-wrap items-baseline gap-2"><h2 className="font-semibold">Getting started</h2><span className="num text-xs text-fg-3">{done} of {steps.length} done</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-bg-3"><div className="h-full bg-mint transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.id} className={`flex gap-2 rounded-lg border p-2 ${s.done ? "border-border opacity-60" : "border-border bg-bg-2"}`}>
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${s.done ? "bg-mint text-black" : "bg-bg-3 text-fg-2"}`}>{s.done ? "✓" : i + 1}</span>
            <div className="min-w-0">
              <Link href={s.href} className={`font-medium ${s.done ? "line-through" : "hover:text-mint"}`}>{s.title}</Link>
              <p className="text-xs text-fg-3">{s.why}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
