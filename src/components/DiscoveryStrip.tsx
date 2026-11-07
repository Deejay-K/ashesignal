"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CATS = [
  { key: "confirmed", label: "Confirmed Trades", tone: "tab-green", hint: "criteria met" },
  { key: "watching", label: "Watching", tone: "tab-blue", hint: "close, no trigger" },
  { key: "speculative", label: "Speculative", tone: "tab-amber", hint: "high risk" },
  { key: "spot", label: "Spot Investments", tone: "tab-violet", hint: "buy and hold" },
] as const;

/** Dashboard entry point to Trading Discovery with live counts. */
export default function DiscoveryStrip() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { fetch("/api/opportunities?cat=all").then((r) => r.json()).then((d) => { setCounts(d.counts ?? {}); if (d.note) setNote(d.note); }).catch(() => setCounts({})); }, []);
  return (
    <div className="opp-tabs">
      {CATS.map((c) => (
        <Link key={c.key} href={`/opportunities?cat=${c.key}`} className={`opp-tab ${c.tone}`}>
          <span className="opp-dot" />
          <span>{c.label}</span>
          <span className="text-fg-3 hidden sm:inline">{c.hint}</span>
          <span className="num opp-count">{counts ? counts[c.key] ?? 0 : "…"}</span>
        </Link>
      ))}
      {note ? <span className="w-full text-[11px] text-fg-3">{note}</span> : null}
    </div>
  );
}
