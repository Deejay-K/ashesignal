"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Disclaimer, Empty, OutlookBadge, Section } from "@/components/ui";
import { fmtPct, fmtUsd, pctClass, timeAgo } from "@/lib/format";

interface Row { asset_key: string; symbol: string; name: string; timeframe: string; price: number; market_cap: number | null; volume_24h: number | null; change_24h_pct: number | null; score: number; outlook: string; opportunity: number; rsi: number; atr_pct: number; vol_ratio: number; vol_regime: string; trend: string; macd_cross: string | null; breakout: string | null; setup_side: string | null; setup_kind: string | null; setup_rr: number | null; setup_confidence: number | null; leverage: number | null; patterns: string[]; updated_at: string }

const PRESETS: { name: string; f: Partial<Filters> }[] = [
  { name: "All", f: {} },
  { name: "Confirmed longs", f: { side: "LONG", kind: "confirmed" } },
  { name: "Confirmed shorts", f: { side: "SHORT", kind: "confirmed" } },
  { name: "Oversold bounce", f: { rsiMax: 32, side: "LONG" } },
  { name: "Overbought", f: { rsiMin: 68 } },
  { name: "Volume spikes", f: { volMin: 2 } },
  { name: "Breakouts", f: { breakout: "breakout" } },
  { name: "Breakdowns", f: { breakout: "breakdown" } },
  { name: "Squeezes", f: { regime: "squeeze" } },
  { name: "High R:R (>=2)", f: { rrMin: 2 } },
];
interface Filters { side: string; kind: string; rsiMin: number | null; rsiMax: number | null; volMin: number | null; breakout: string; regime: string; rrMin: number | null; scoreMin: number | null; scoreMax: number | null; q: string }
const EMPTY: Filters = { side: "", kind: "", rsiMin: null, rsiMax: null, volMin: null, breakout: "", regime: "", rrMin: null, scoreMin: null, scoreMax: null, q: "" };

export default function ScreenerPage() {
  const [tf, setTf] = useState("4h");
  const [d, setD] = useState<{ rows: Row[]; updatedAt: number | null; note?: string } | null>(null);
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<{ k: keyof Row; dir: 1 | -1 }>({ k: "opportunity", dir: -1 });
  useEffect(() => { setD(null); fetch(`/api/screener?tf=${tf}`).then((r) => r.json()).then(setD).catch(() => {}); }, [tf]);
  const rows = useMemo(() => {
    if (!d) return [];
    return d.rows.filter((r) => {
      if (f.q && !(`${r.symbol} ${r.name}`.toLowerCase().includes(f.q.toLowerCase()))) return false;
      if (f.side && r.setup_side !== f.side) return false;
      if (f.kind && r.setup_kind !== f.kind) return false;
      if (f.rsiMin != null && r.rsi < f.rsiMin) return false;
      if (f.rsiMax != null && r.rsi > f.rsiMax) return false;
      if (f.volMin != null && r.vol_ratio < f.volMin) return false;
      if (f.breakout && r.breakout !== f.breakout) return false;
      if (f.regime && r.vol_regime !== f.regime) return false;
      if (f.rrMin != null && (r.setup_rr ?? 0) < f.rrMin) return false;
      if (f.scoreMin != null && r.score < f.scoreMin) return false;
      if (f.scoreMax != null && r.score > f.scoreMax) return false;
      return true;
    }).sort((a, b) => { const x = a[sort.k], y = b[sort.k]; const nx = typeof x === "number" ? x : x == null ? -Infinity : 0; const ny = typeof y === "number" ? y : y == null ? -Infinity : 0; return (nx - ny) * sort.dir; });
  }, [d, f, sort]);
  const th = (k: keyof Row, label: string, right = true) => (
    <th className={right ? "text-right" : ""}><button className="hover:text-fg" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>{label}{sort.k === k ? (sort.dir === -1 ? " ▾" : " ▴") : ""}</button></th>
  );
  const num = (k: keyof Filters) => ({ type: "number", value: (f[k] as number | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) }), className: "!py-1 text-xs" }) as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Screener</h1>
          <p className="text-xs text-fg-3">Top 100 Binance-listed coins, engine metrics refreshed by the worker{d?.updatedAt ? ` · updated ${timeAgo(d.updatedAt)}` : ""}</p>
        </div>
        <div className="ml-auto flex gap-1">{["1h", "4h", "1d"].map((t) => <button key={t} className="btn-ghost" data-active={tf === t} onClick={() => setTf(t)}>{t}</button>)}</div>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">{PRESETS.map((p) => <button key={p.name} className="btn-ghost" onClick={() => setF({ ...EMPTY, ...p.f })}>{p.name}</button>)}</div>
      <Section title="Filters">
        <div className="grid grid-cols-2 gap-2 text-xs text-fg-3 sm:grid-cols-4 lg:grid-cols-6">
          <label>Search<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="!py-1 text-xs" placeholder="BTC, solana" /></label>
          <label>Side<select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })} className="!py-1 text-xs"><option value="">any</option><option>LONG</option><option>SHORT</option></select></label>
          <label>Setup kind<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="!py-1 text-xs"><option value="">any</option><option value="confirmed">confirmed</option><option value="speculative">speculative</option><option value="watch">watch</option></select></label>
          <label>Breakout<select value={f.breakout} onChange={(e) => setF({ ...f, breakout: e.target.value })} className="!py-1 text-xs"><option value="">any</option><option value="breakout">breakout</option><option value="breakdown">breakdown</option></select></label>
          <label>Volatility<select value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })} className="!py-1 text-xs"><option value="">any</option><option value="squeeze">squeeze</option><option value="normal">normal</option><option value="expanded">expanded</option></select></label>
          <label>Min R:R<input {...num("rrMin")} /></label>
          <label>RSI min<input {...num("rsiMin")} /></label>
          <label>RSI max<input {...num("rsiMax")} /></label>
          <label>Min volume x avg<input {...num("volMin")} /></label>
          <label>Score min<input {...num("scoreMin")} /></label>
          <label>Score max<input {...num("scoreMax")} /></label>
          <div className="flex items-end"><button className="btn-ghost" onClick={() => setF(EMPTY)}>Clear</button></div>
        </div>
      </Section>
      <Section title={`${rows.length} coins on ${tf}`}>
        {!d ? <div className="h-40 animate-pulse rounded-lg bg-bg-3" /> : d.note ? <Empty>{d.note}</Empty> : !d.rows.length ? <Empty>No metrics yet: the worker fills this within ~1 hour of deploy (10 coins every 5 min).</Empty> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Coin</th>{th("price", "Price")}{th("change_24h_pct", "24h")}{th("score", "Score")}{th("opportunity", "Opp")}{th("rsi", "RSI")}{th("vol_ratio", "Vol x")}{th("atr_pct", "ATR%")}<th>Trend</th><th>Setup</th>{th("setup_rr", "R:R")}{th("leverage", "Lev")}<th>Signals</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.asset_key} className="hover:bg-bg-3">
                    <td><Link href={`/token/${r.asset_key.slice(3)}`} className="font-medium hover:text-mint">{r.symbol}</Link> <span className="text-xs text-fg-3">{r.name}</span></td>
                    <td className="num text-right">{fmtUsd(r.price)}</td>
                    <td className={`num text-right ${pctClass(r.change_24h_pct)}`}>{fmtPct(r.change_24h_pct, 1)}</td>
                    <td className={`num text-right ${r.score > 0 ? "up" : r.score < 0 ? "down" : ""}`}>{r.score > 0 ? "+" : ""}{r.score}</td>
                    <td className="num text-right">{r.opportunity}</td>
                    <td className={`num text-right ${r.rsi >= 70 ? "down" : r.rsi <= 30 ? "up" : ""}`}>{Number(r.rsi).toFixed(0)}</td>
                    <td className={`num text-right ${r.vol_ratio >= 2 ? "up" : r.vol_ratio < 0.5 ? "text-fg-3" : ""}`}>{Number(r.vol_ratio).toFixed(1)}</td>
                    <td className="num text-right">{Number(r.atr_pct).toFixed(2)}</td>
                    <td><OutlookBadge outlook={r.outlook} /></td>
                    <td>{r.setup_side ? <span className={`pill ${r.setup_kind === "confirmed" ? "pill-mint" : r.setup_kind === "speculative" ? "pill-amber" : "pill-gray"}`}>{r.setup_side} {r.setup_kind}</span> : "-"}</td>
                    <td className="num text-right">{r.setup_rr ?? "-"}</td>
                    <td className="num text-right">{r.leverage ? `${r.leverage}x` : "-"}</td>
                    <td className="max-w-[220px] truncate text-xs text-fg-3" title={[r.breakout ?? "", r.macd_cross ? `MACD ${r.macd_cross}` : "", ...(r.patterns ?? [])].filter(Boolean).join(" · ")}>{[r.breakout ?? "", r.macd_cross ? `MACD ${r.macd_cross}` : "", ...(r.patterns ?? [])].filter(Boolean).join(" · ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Disclaimer />
    </div>
  );
}
