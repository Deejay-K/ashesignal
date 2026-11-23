"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/ui";
import type { Calibration as Cal } from "@/app/api/calibration/route";

/** Does a higher confidence number actually mean a higher hit rate? This table is the answer. */
export default function Calibration() {
  const [c, setC] = useState<Cal | null>(null);
  useEffect(() => { fetch("/api/calibration").then((r) => (r.ok ? r.json() : null)).then(setC).catch(() => {}); }, []);
  if (!c || !c.total) return null;
  const rows = c.byKind.confirmed?.some((b) => b.n) ? c.byKind.confirmed : c.buckets;
  return (
    <Section title={`Setup score calibration (${c.total} resolved signals, 120 days)`}>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Setup score</th><th className="text-right">Signals</th><th className="text-right">Reached TP1</th><th className="text-right">Reached TP2+</th><th className="text-right">Stopped</th></tr></thead>
          <tbody>{rows.map((b) => <tr key={b.band}><td className="num">{b.band}</td><td className="num text-right">{b.n}</td><td className={`num text-right ${b.hitRate != null ? (b.hitRate >= 55 ? "up" : b.hitRate < 45 ? "down" : "") : ""}`}>{b.hitRate != null ? `${b.hitRate}%` : "-"}</td><td className="num text-right">{b.n ? Math.round((100 * b.tp2) / b.n) + "%" : "-"}</td><td className="num text-right">{b.n ? Math.round((100 * b.sl) / b.n) + "%" : "-"}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-3">If the hit rate rises with the band, the confidence score carries information and you can size by it. If it does not, treat confidence as a label, not a probability. Cards show the band hit rate next to the confidence once a band has 5+ resolved signals.</p>
    </Section>
  );
}
