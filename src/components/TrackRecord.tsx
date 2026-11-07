"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section } from "./ui";

interface G { key: string; total: number; open: number; tp1: number; tp2: number; tp3: number; sl: number; expired: number; avgMfe: number; avgMae: number; winRate: number | null }

export default function TrackRecord({ assetKey, symbol }: { assetKey: string; symbol: string }) {
  const [d, setD] = useState<{ total: number; byTimeframe: G[]; bySide: G[] } | null>(null);
  useEffect(() => { fetch(`/api/performance?asset=${encodeURIComponent(assetKey)}`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}); }, [assetKey]);
  if (!d || !d.total) return null;
  const all = d.bySide.reduce((acc, g) => ({ total: acc.total + g.total, open: acc.open + g.open, wins: acc.wins + g.tp1 + g.tp2 + g.tp3, sl: acc.sl + g.sl }), { total: 0, open: 0, wins: 0, sl: 0 });
  const resolved = all.total - all.open;
  return (
    <Section title={`Engine track record on ${symbol}`} right={<Link href="/performance" className="link text-xs">all coins</Link>}>
      <div className="num grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="card-3 p-2"><div className="text-[10px] uppercase tracking-wider text-fg-3">Signals</div><div className="font-semibold">{all.total} <span className="text-fg-3">({all.open} open)</span></div></div>
        <div className="card-3 p-2"><div className="text-[10px] uppercase tracking-wider text-fg-3">Win rate</div><div className={`font-semibold ${resolved && all.wins / resolved >= 0.5 ? "up" : resolved ? "down" : ""}`}>{resolved ? `${Math.round((all.wins / resolved) * 100)}%` : "-"}</div></div>
        <div className="card-3 p-2"><div className="text-[10px] uppercase tracking-wider text-fg-3">Stopped</div><div className="font-semibold down">{all.sl}</div></div>
        <div className="card-3 p-2"><div className="text-[10px] uppercase tracking-wider text-fg-3">By timeframe</div><div className="text-xs text-fg-2">{d.byTimeframe.map((g) => `${g.key} ${g.winRate ?? "-"}%`).join(" · ")}</div></div>
      </div>
      <p className="mt-2 text-xs text-fg-3">How this engine's own signals on this coin resolved against real price (first touch of TP or SL1). Small samples mean little.</p>
    </Section>
  );
}
