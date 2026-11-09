"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { fmtUsd, timeAgo } from "@/lib/format";
import type { Radar } from "@/lib/radar";

/** Holdings Radar: the engine's view of every coin you hold, with one plain action each. */
export default function RadarPage() {
  const [r, setR] = useState<Radar | null | undefined>(undefined);
  const [guest, setGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/me/radar").then(async (x) => { if (x.status === 401) { setGuest(true); setR(null); return; } setR(x.ok ? await x.json() : null); }).catch(() => setR(null));
  useEffect(() => { load(); }, []);
  const refresh = async () => { setBusy(true); await fetch("/api/me/portfolio?snapshot=1").catch(() => {}); await load(); setBusy(false); };
  if (r === undefined) return <div className="space-y-3"><div className="skeleton h-8 w-48" /><div className="skeleton h-40" /></div>;
  if (guest) return <p className="text-sm text-fg-2"><Link className="link" href="/login">Sign in</Link> and connect a wallet or a read-only exchange key to see the radar.</p>;
  if (!r) return <p className="text-sm text-red">Radar unavailable right now.</p>;
  const toneCls = (t: string) => (t === "up" ? "border-mint/40" : t === "down" ? "border-red/50" : t === "amber" ? "border-amber/40" : "border-border");
  const toneText = (t: string) => (t === "up" ? "text-mint" : t === "down" ? "text-red" : t === "amber" ? "text-amber" : "text-fg-2");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Holdings radar</h1>
          <p className="text-sm text-fg-2">What the engine says right now about each coin you hold, and one plain thing to do about it. {r.takenAt ? `Holdings from ${timeAgo(Date.parse(r.takenAt))}.` : ""}</p>
        </div>
        <button className="btn-ghost text-sm" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh holdings"}</button>
      </div>
      {r.note ? <p className="rounded-lg border border-amber/40 bg-amber-dim p-3 text-sm text-amber">{r.note} <Link className="link" href="/portfolio">Portfolio</Link></p> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Total" value={fmtUsd(r.totalUsd)} sub={`${fmtUsd(r.stableUsd)} in stablecoins`} />
        <StatCard label="Sell or protect" value={String(r.rows.filter((x) => x.tone === "down").length)} sub="engine says reduce" />
        <StatCard label="Positive" value={String(r.rows.filter((x) => x.tone === "up").length)} sub="confirmed long, in zone, trend up" />
        <StatCard label="Not screened" value={String(r.unscreened.length)} sub="no engine data yet" />
      </div>
      <p className="text-sm text-fg-2">{r.summary}</p>
      <div className="space-y-2">
        {r.rows.map((x) => (
          <div key={x.symbol} className={`card space-y-1.5 border p-3 ${toneCls(x.tone)}`}>
            <div className="flex flex-wrap items-center gap-2">
              {x.coingeckoId ? <Link href={`/token/${x.coingeckoId}`} className="font-semibold hover:text-mint">{x.symbol}</Link> : <b>{x.symbol}</b>}
              <span className="text-xs text-fg-3">{x.name}</span>
              <span className="num ml-auto text-sm">{fmtUsd(x.valueUsd)} <span className="text-xs text-fg-3">({x.pct.toFixed(1)}%)</span></span>
            </div>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {x.views.map((v) => <span key={v.tf} className={`pill ${v.category === "confirmed" ? (v.side === "SHORT" ? "pill-red" : "pill-mint") : v.category === "watching" ? "pill-amber" : "pill-gray"}`}>{v.tf} {v.outlook ?? "?"}{v.score != null ? ` ${v.score > 0 ? "+" : ""}${v.score}` : ""}{v.category && v.category !== "none" ? ` · ${v.category}${v.side ? ` ${v.side}` : ""}` : ""}</span>)}
              {x.spot ? <span className={`pill ${x.spot.inZone ? "pill-mint" : "pill-gray"}`}>spot {x.spot.tier}{x.spot.inZone ? " · in zone" : ""}</span> : null}
              {x.change24h != null ? <span className={`pill pill-gray ${x.change24h >= 0 ? "up" : "down"}`}>{x.change24h >= 0 ? "+" : ""}{Number(x.change24h).toFixed(1)}% 24h</span> : null}
            </div>
            <p className={`text-sm ${toneText(x.tone)}`}>{x.action}</p>
            {x.flags.length ? <p className="text-xs text-amber">⚠ {x.flags.join(" · ")}</p> : null}
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {x.coingeckoId ? <Link className="btn-ghost !py-1 !text-[11px]" href={`/s/${x.coingeckoId}/4h`}>Setup page</Link> : null}
              <Link className="btn-ghost !py-1 !text-[11px]" href={`/dca?symbol=${x.symbol}`}>DCA plan</Link>
            </div>
          </div>
        ))}
      </div>
      {r.unscreened.length ? <Section title="Not covered by the screener"><p className="text-xs text-fg-2">{r.unscreened.map((u) => `${u.symbol} (${fmtUsd(u.valueUsd)})`).join(", ")}. Open them from search for a live analysis.</p></Section> : null}
      <Disclaimer />
    </div>
  );
}
