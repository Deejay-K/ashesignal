"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface Row { id: number; asset_key: string; symbol: string | null; timeframe: string | null; category: string; prev_category: string | null; reason: string | null; changed_at: string }

const COLOR: Record<string, string> = { confirmed: "pill-mint", watching: "pill-gray", speculative: "pill-amber", spot: "pill-gray", none: "pill-gray" };

/** Latest category moves across all tracked tokens. */
export default function CategoryHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { fetch("/api/opportunities/history").then((r) => r.json()).then((d) => setRows(d.rows ?? [])).catch(() => setRows([])); }, []);
  const href = (r: Row) => r.asset_key.startsWith("cg:") ? `/token/${r.asset_key.slice(3)}` : r.asset_key.startsWith("addr:") ? `/scanner?address=${encodeURIComponent(r.asset_key.split(":")[2] ?? "")}` : "#";
  return (
    <Section title="Category history" right={<span className="text-xs text-fg-3">how opportunities developed, last 90 days</span>}>
      {!rows ? <div className="h-20 animate-pulse" /> : !rows.length ? <p className="text-xs text-fg-3">No changes recorded yet. The worker writes a row every time a token enters, leaves or changes category.</p> : (
        <ol className="max-h-80 space-y-1 overflow-auto text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1">
              <span className="num w-24 shrink-0 text-fg-3" title={new Date(r.changed_at).toLocaleString()}>{timeAgo(Date.parse(r.changed_at))}</span>
              <Link href={href(r)} className="link font-medium">{r.symbol ?? r.asset_key}</Link>
              {r.timeframe ? <span className="text-fg-3">{r.timeframe}</span> : null}
              <span className={`pill ${COLOR[r.prev_category ?? "none"]}`}>{r.prev_category ?? "none"}</span>
              <span className="text-fg-3">→</span>
              <span className={`pill ${COLOR[r.category]}`}>{r.category}</span>
              <span className="text-fg-2">{r.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
