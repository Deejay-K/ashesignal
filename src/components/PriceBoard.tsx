"use client";

import { useEffect, useState } from "react";
import type { PriceBoard as PB } from "@/lib/market/prices";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import { Section } from "./ui";
import { VENUE_EVENT } from "@/lib/venue-pref";
import { VENUE_META, splitInstrument, type VenueId } from "@/lib/venues";

export default function PriceBoard({ symbol }: { symbol: string }) {
  const [b, setB] = useState<PB | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/prices?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => alive && setB(j)).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    window.addEventListener(VENUE_EVENT, load);
    return () => { alive = false; clearInterval(t); window.removeEventListener(VENUE_EVENT, load); };
  }, [symbol]);
  if (!b) return <Section title="Exchange prices"><div className="h-24 animate-pulse rounded-lg bg-bg-3" /></Section>;
  if (!b.venues.length) return null;
  return (
    <Section title="Exchange prices (live)" right={<span className="num text-xs text-fg-3">aggregate <b className="text-fg">{fmtUsd(b.aggregate)}</b>{b.spreadPct != null ? ` · spread ${b.spreadPct.toFixed(3)}%` : ""}</span>}>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Venue</th><th>Pair</th><th className="text-right">Last</th><th className="text-right">vs agg</th><th className="text-right">24h</th><th className="text-right">24h volume</th></tr></thead>
          <tbody>
            {b.venues.map((v) => {
              const diff = b.aggregate ? ((v.last - b.aggregate) / b.aggregate) * 100 : null;
              return (
                <tr key={v.venue} className={v.active ? "bg-mint-dim/40" : ""}>
                  <td className="font-medium">{VENUE_META[v.venue as VenueId]?.label ?? v.venue}{v.active ? <span className="pill pill-mint ml-1">active</span> : null}</td>
                  <td className="text-fg-3"><a className="link" href={VENUE_META[v.venue as VenueId]?.tradeUrl(splitInstrument(v.venue as VenueId, v.instrument).base, splitInstrument(v.venue as VenueId, v.instrument).quote)} target="_blank" rel="noreferrer" title={`Open ${v.instrument} on ${v.venue}`}>{v.instrument}</a></td>
                  <td className="num text-right">{fmtUsd(v.last)}</td>
                  <td className={`num text-right ${pctClass(diff)}`}>{diff != null ? fmtPct(diff, 3) : "-"}</td>
                  <td className={`num text-right ${pctClass(v.change24hPct)}`}>{fmtPct(v.change24hPct, 2)}</td>
                  <td className="num text-right text-fg-2">{fmtUsd(v.volumeQuote24h, { compact: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-3">Aggregate is volume-weighted across venues. A spread above ~0.3% on a liquid coin usually means one venue is lagging or thin - check before using a single exchange's price for entries.</p>
    </Section>
  );
}
