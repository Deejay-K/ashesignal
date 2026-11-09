"use client";

import { useEffect, useState } from "react";
import type { PreTrade } from "@/lib/trade-check";

/** The checklist shown before a trade is recorded. Fetches once per distinct inputs; never blocks saving. */
export default function PreTradeChecklist({ symbol, side, kind, price, entry, stop, risk, venue, gap, onVerdict }: { symbol: string; side: "LONG" | "SHORT"; kind: string; price: number | null; entry: { low: number; high: number } | null; stop: number | null; risk: number | null; venue: string; gap?: string; onVerdict?: (v: string | null) => void }) {
  const [r, setR] = useState<PreTrade | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const key = JSON.stringify([symbol, side, kind, price, entry, stop, risk, venue]);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ symbol, side, kind, venue });
      if (price) q.set("price", String(price)); if (entry) { q.set("entryLow", String(entry.low)); q.set("entryHigh", String(entry.high)); } if (stop) q.set("stop", String(stop)); if (risk) q.set("risk", String(risk)); if (gap) q.set("gap", gap);
      fetch(`/api/pretrade?${q}`).then((x) => (x.ok ? x.json() : null)).then((j) => { setR(j); onVerdict?.(j?.verdict ?? null); }).catch(() => { setR(null); onVerdict?.(null); });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (r === undefined) return <p className="text-xs text-fg-3">Running the pre-trade checklist…</p>;
  if (!r) return null;
  const tone = r.verdict === "go" ? "border-mint/40 bg-mint-dim text-mint" : r.verdict === "careful" ? "border-amber/40 bg-amber-dim text-amber" : "border-red/50 bg-red/10 text-red";
  const icon = (l: string) => (l === "ok" ? "✓" : l === "warn" ? "!" : l === "fail" ? "✕" : "·");
  return (
    <div className={`rounded border px-2 py-1.5 text-xs ${tone}`}>
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span><b>Pre-trade check: {r.verdict === "go" ? "go" : r.verdict === "careful" ? "careful" : "wait"}.</b> {r.summary}</span>
        <span className="shrink-0">{open ? "hide" : `${r.checks.length} checks`}</span>
      </button>
      {open ? (
        <ul className="mt-1.5 space-y-1 text-fg-2">
          {r.checks.map((c) => <li key={c.id} className="flex gap-2"><span className={`num w-3 shrink-0 text-center ${c.level === "ok" ? "text-mint" : c.level === "warn" ? "text-amber" : c.level === "fail" ? "text-red" : "text-fg-3"}`}>{icon(c.level)}</span><span><b className="text-fg">{c.label}.</b> {c.detail}</span></li>)}
        </ul>
      ) : null}
    </div>
  );
}
