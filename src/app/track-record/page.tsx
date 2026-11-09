"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { TrackRecord, Bucket } from "@/lib/track-record";

/** Public, un-editable track record: every signal the engine emitted and how it resolved, plus your own record. */
export default function TrackRecordPage() {
  const [d, setD] = useState<TrackRecord | null | undefined>(undefined);
  useEffect(() => { fetch("/api/track-record").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)); }, []);
  if (d === undefined) return <div className="space-y-3"><div className="skeleton h-8 w-48" /><div className="skeleton h-24" /><div className="skeleton h-64" /></div>;
  if (!d) return <p className="text-sm text-fg-2">Track record unavailable (no database configured).</p>;
  const t = d.signals.total;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Track record</h1>
        <p className="text-sm text-fg-2">Every setup the engine has emitted{d.since ? ` since ${new Date(d.since).toLocaleDateString()}` : ""}, graded on what price actually did afterwards (TP1, TP2, TP3, stop, or expired). Written by the worker only; nobody can edit a row. R counts the target distance over the stop distance; a stop is -1R, expiry 0R.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Signals" value={String(t.n)} sub={`${t.resolved} resolved`} />
        <StatCard label="Win rate" value={t.winRate != null ? `${t.winRate}%` : "-"} sub={`${t.wins} wins / ${t.losses} stops / ${t.expired} expired`} />
        <StatCard label="Avg R" value={t.avgR != null ? `${t.avgR > 0 ? "+" : ""}${t.avgR}R` : "-"} sub="per resolved signal" />
        <StatCard label="Total R" value={`${t.sumR > 0 ? "+" : ""}${t.sumR}R`} sub={<Link href="/performance" className="link">calibration</Link>} />
      </div>
      <Section title="Cumulative R, all resolved signals"><Curve pts={d.signals.curve} /></Section>
      <div className="grid gap-3 md:grid-cols-3">
        <Section title="By kind"><BucketTable rows={d.signals.byKind} /></Section>
        <Section title="By timeframe"><BucketTable rows={d.signals.byTimeframe} /></Section>
        <Section title="By side"><BucketTable rows={d.signals.bySide} /></Section>
      </div>
      <Section title="By month"><BucketTable rows={d.signals.byMonth} /></Section>
      <Section title="Broadcast Confirmed trades (Telegram follow-ups)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
          <StatCard label="Sent" value={String(d.followups.total)} sub={`${d.followups.open} still open`} />
          <StatCard label="TP1 hit" value={String(d.followups.tp1)} sub={d.followups.tp1Rate != null ? `${d.followups.tp1Rate}% of closed` : ""} />
          <StatCard label="TP2 hit" value={String(d.followups.tp2)} />
          <StatCard label="Stopped" value={String(d.followups.sl)} />
          <StatCard label="Lost confirmation" value={String(d.followups.lost)} sub="before TP1" />
        </div>
        {d.followups.recent.length ? <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th>Trade</th><th>Sent</th><th>Zone</th><th>TP1</th><th>TP2</th><th>SL</th><th>Lost</th></tr></thead><tbody>
          {d.followups.recent.map((f: Record<string, string | null>) => <tr key={f.id as string} className="border-t border-border"><td className="py-1 font-medium">{f.symbol} {f.side} {f.timeframe}</td><td className="text-fg-3">{timeAgo(Date.parse(f.emitted_at as string))}</td><td>{f.zone_at ? "✓" : ""}</td><td className="text-mint">{f.tp1_at ? "✓" : ""}</td><td className="text-mint">{f.tp2_at ? "✓" : ""}</td><td className="text-red">{f.sl_at ? "✓" : ""}</td><td className="text-amber">{f.lost_at ? "✓" : ""}</td></tr>)}
        </tbody></table></div> : <p className="mt-2 text-xs text-fg-3">No broadcast yet. Rows appear as soon as the worker confirms a trade with Telegram configured.</p>}
      </Section>
      {d.journal ? (
        <Section title="Your own record" right={<Link className="link text-xs" href="/setups">journal</Link>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Taken" value={String(d.journal.total.n)} sub={`${d.journal.total.resolved} closed`} />
            <StatCard label="Win rate" value={d.journal.total.winRate != null ? `${d.journal.total.winRate}%` : "-"} />
            <StatCard label="Real" value={d.journal.real.sumR ? `${d.journal.real.sumR > 0 ? "+" : ""}${d.journal.real.sumR}R` : "-"} sub={`${d.journal.real.n} trades`} />
            <StatCard label="Paper" value={d.journal.paper.sumR ? `${d.journal.paper.sumR > 0 ? "+" : ""}${d.journal.paper.sumR}R` : "-"} sub={`${d.journal.paper.n} trades`} />
          </div>
          <div className="mt-2"><Curve pts={d.journal.curve} /></div>
          <div className="mt-2"><BucketTable rows={d.journal.byTimeframe} /></div>
        </Section>
      ) : <p className="text-xs text-fg-3"><Link href="/login" className="link">Sign in</Link> to see your own record next to the engine's.</p>}
      <Section title="Recent signals">
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th>Coin</th><th>Side</th><th>TF</th><th>Kind</th><th>Emitted</th><th>Outcome</th><th className="text-right">R</th></tr></thead><tbody>
          {d.signals.recent.map((s, i) => <tr key={i} className="border-t border-border"><td className="py-1 font-medium">{s.symbol}</td><td className={s.side === "LONG" ? "text-mint" : "text-red"}>{s.side}</td><td>{s.timeframe}</td><td>{s.kind}</td><td className="text-fg-3">{timeAgo(Date.parse(s.emitted_at))}</td><td>{s.outcome ?? "open"}</td><td className={`num text-right ${s.r == null ? "" : s.r > 0 ? "up" : s.r < 0 ? "down" : ""}`}>{s.r == null ? "" : `${s.r > 0 ? "+" : ""}${s.r}`}</td></tr>)}
        </tbody></table></div>
      </Section>
      <Disclaimer />
    </div>
  );
}

function BucketTable({ rows }: { rows: Bucket[] }) {
  if (!rows.length) return <p className="text-xs text-fg-3">No data yet.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-fg-3"><th>Group</th><th className="text-right">n</th><th className="text-right">Win</th><th className="text-right">Avg R</th><th className="text-right">Total R</th></tr></thead><tbody>
      {rows.map((b) => <tr key={b.key} className="border-t border-border"><td className="py-1 font-medium">{b.key}</td><td className="num text-right">{b.n}</td><td className="num text-right">{b.winRate != null ? `${b.winRate}%` : "-"}</td><td className={`num text-right ${b.avgR == null ? "" : b.avgR >= 0 ? "up" : "down"}`}>{b.avgR != null ? `${b.avgR > 0 ? "+" : ""}${b.avgR}` : "-"}</td><td className={`num text-right ${b.sumR >= 0 ? "up" : "down"}`}>{b.sumR > 0 ? "+" : ""}{b.sumR}</td></tr>)}
    </tbody></table></div>
  );
}

/** Tiny SVG equity curve; no library needed. */
function Curve({ pts }: { pts: { t: string; r: number }[] }) {
  if (pts.length < 2) return <p className="text-xs text-fg-3">The curve appears after two resolved signals.</p>;
  const W = 600, H = 140, pad = 6;
  const ys = pts.map((p) => p.r); const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys); const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + ((hi - v) / span) * (H - pad * 2);
  const dpath = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1].r;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label="Cumulative R">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="4 4" />
      <path d={dpath} fill="none" stroke={last >= 0 ? "var(--mint)" : "var(--red)"} strokeWidth={2} />
      <text x={W - pad} y={y(last) - 6} textAnchor="end" fill="var(--fg-2)" fontSize={12}>{last > 0 ? "+" : ""}{last}R</text>
    </svg>
  );
}
