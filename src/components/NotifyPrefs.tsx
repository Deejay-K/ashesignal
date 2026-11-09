"use client";

import { useEffect, useState } from "react";
import type { NotifyKind, NotifyPrefs as Prefs } from "@/lib/alerts/notify";

const KINDS: { k: NotifyKind; label: string; hint: string }[] = [
  { k: "confirmed", label: "New confirmed trades", hint: "per-coin 'when it confirms' alerts" },
  { k: "trade", label: "My trade updates", hint: "TP1, TP2, stop on trades in your journal" },
  { k: "price", label: "Price and zone alerts", hint: "above/below, entry zone, TP/SL price rules" },
  { k: "spot", label: "Spot zone alerts", hint: "a spot pick enters accumulation" },
  { k: "digest", label: "Daily digest", hint: "at your digest hour" },
  { k: "review", label: "Weekly review", hint: "Sundays" },
  { k: "other", label: "Everything else", hint: "RSI, patterns, whales, listings" },
];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Per-type toggles, quiet hours and a test button. Stored in profiles.preferences.notify. */
export default function NotifyPrefs() {
  const [p, setP] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => { fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => setP((j?.profile?.preferences?.notify ?? j?.preferences?.notify ?? {}) as Prefs)).catch(() => setP({})); }, []);
  if (!p) return null;
  const save = async (next: Prefs) => {
    setP(next); setSaved("saving");
    const r = await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { notify: next } }) });
    setSaved(r.ok ? "saved" : "error"); setTimeout(() => setSaved(null), 1500);
  };
  const on = (k: NotifyKind) => p.types?.[k] !== false;
  const runTest = async () => { setTest("sending"); const r = await fetch("/api/me/notify-test", { method: "POST" }); const j = await r.json().catch(() => ({})); setTest(r.ok ? `sent: push ${j.push ?? 0}, email ${j.email ? "yes" : "no"}, Discord ${j.discord ? "yes" : "no"}, Telegram ${j.telegram ? "yes" : "no"}` : "failed"); };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-fg-2">Choose which kinds of messages reach your push, email, Discord and Telegram. The in-app inbox always keeps everything. Quiet hours are in UTC (now {new Date().getUTCHours()}:00 UTC).</p>
      <ul className="space-y-1">
        {KINDS.map((k) => (
          <li key={k.k} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-2 px-2 py-1.5">
            <div><div className="font-medium">{k.label}</div><div className="text-xs text-fg-3">{k.hint}</div></div>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="w-auto" checked={on(k.k)} onChange={(e) => save({ ...p, types: { ...(p.types ?? {}), [k.k]: e.target.checked } })} /> {on(k.k) ? "on" : "off"}</label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label>Quiet from (UTC)<select value={p.quietStart ?? ""} onChange={(e) => save({ ...p, quietStart: e.target.value === "" ? null : Number(e.target.value) })}><option value="">off</option>{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
        <label>until<select value={p.quietEnd ?? ""} onChange={(e) => save({ ...p, quietEnd: e.target.value === "" ? null : Number(e.target.value) })}><option value="">off</option>{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
        <label className="flex items-center gap-1 pb-2"><input type="checkbox" className="w-auto" checked={!!p.quietAllowTrade} onChange={(e) => save({ ...p, quietAllowTrade: e.target.checked })} /> still send my trade updates during quiet hours</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost text-xs" onClick={runTest} disabled={test === "sending"}>Send a test to all channels</button>
        {test ? <span className="text-xs text-fg-3">{test}</span> : null}
        {saved ? <span className="ml-auto text-xs text-fg-3">{saved}</span> : null}
      </div>
    </div>
  );
}
