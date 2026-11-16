"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Check { id: string; label: string; level: "ok" | "warn" | "down" | "info"; detail: string; at?: string | null }
interface Status { overall: "ok" | "warn" | "down"; headline: string; checks: Check[]; at: string; error?: string }

const DOT: Record<string, string> = { ok: "bg-mint", warn: "bg-amber", down: "bg-red", info: "bg-fg-3" };
const WORD: Record<string, string> = { ok: "OK", warn: "Check", down: "Down", info: "Info" };

/** Owner health page: one glance to know whether signals are flowing. */
export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => { setBusy(true); fetch("/api/status").then((r) => r.json()).then(setS).catch(() => setS({ overall: "down", headline: "The status check itself did not answer.", checks: [], at: new Date().toISOString() })).finally(() => setBusy(false)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  if (s?.error) return <div className="mx-auto max-w-xl space-y-3"><h1 className="text-xl font-bold">System status</h1><div className="card p-4 text-sm text-fg-2">{s.error}</div><Link className="link text-sm" href="/login">Sign in</Link></div>;
  const tone = s?.overall === "ok" ? "border-mint/40" : s?.overall === "warn" ? "border-amber/40" : "border-red/40";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">System status</h1>
        <button type="button" className="btn-ghost ml-auto !py-1 text-xs" onClick={load} disabled={busy}>{busy ? "Checking..." : "Check again"}</button>
      </div>
      {!s ? <div className="card h-40 animate-pulse" /> : (
        <>
          <div className={`card border ${tone} p-4`}>
            <div className="text-lg font-bold">{s.headline}</div>
            <div className="mt-1 text-xs text-fg-3">Checked {new Date(s.at).toLocaleTimeString()}. This page refreshes every minute.</div>
          </div>
          <div className="card divide-y divide-border">
            {s.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.level]}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{c.label}</span><span className="text-[11px] uppercase tracking-wider text-fg-3">{WORD[c.level]}</span></div>
                  <div className="text-sm text-fg-2">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card p-3 text-xs text-fg-2">
            <b>If the worker shows Down:</b> open your GitHub repository, Actions tab, &quot;AsheSignal worker&quot;. If runs are failing, open the latest one to see which step. If there are no recent runs, GitHub pauses scheduled jobs after 60 days without a commit: press &quot;Enable workflow&quot;, or push any commit.
          </div>
        </>
      )}
    </div>
  );
}
