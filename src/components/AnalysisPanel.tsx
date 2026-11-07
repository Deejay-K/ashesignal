"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";
import PriceChart, { type ChartOverlays } from "./PriceChart";
import { Empty, OutlookBadge, QualityBadge, Section } from "./ui";
import { fmtNum, fmtPct, fmtUsd, pctClass } from "@/lib/format";
import { TIMEFRAMES, type Candle, type Timeframe } from "@/lib/types";
import type { Setup, TimeframeAnalysis } from "@/lib/ta/analysis";
import type { MultiTfAnalysis } from "@/lib/market/analyze";

export interface AssetQuery {
  symbol?: string;
  id?: string;
  network?: string;
  pool?: string;
}

function qs(a: AssetQuery, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  Object.entries({ ...a, ...extra }).forEach(([k, v]) => v && p.set(k, v));
  return p.toString();
}

export default function AnalysisPanel({ asset, defaultTf = "4h", title }: { asset: AssetQuery; defaultTf?: Timeframe; title?: string }) {
  const [tf, setTf] = useState<Timeframe>(defaultTf);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [meta, setMeta] = useState<{ source: string; quality: string; note?: string } | null>(null);
  const [analysis, setAnalysis] = useState<TimeframeAnalysis | null>(null);
  const [multi, setMulti] = useState<MultiTfAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<ChartOverlays>({ ema20: true, ema50: true, sma200: false, bollinger: false, levels: true, setup: true, patterns: true });
  const key = useMemo(() => qs(asset), [asset]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/analyze?${qs(asset, { tf })}`)
      .then((r) => r.json())
      .then(async (a) => {
        if (!alive) return;
        setAnalysis(a.analysis ?? null);
        setMeta({ source: a.source, quality: a.quality, note: a.note });
        const o = await fetch(`/api/ohlcv?${qs(asset, { tf })}`).then((r) => r.json());
        if (!alive) return;
        setCandles(o.candles ?? []);
        if (!o.candles?.length) setErr(o.note ?? "No candle data.");
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tf]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/analyze?${qs(asset)}`)
      .then((r) => r.json())
      .then((m) => alive && setMulti(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // refresh the active timeframe periodically (near-real-time for low TFs)
  useEffect(() => {
    const ms = tf === "1m" ? 15_000 : tf === "5m" ? 30_000 : tf === "15m" || tf === "30m" ? 60_000 : 120_000;
    const t = setInterval(() => {
      fetch(`/api/ohlcv?${qs(asset, { tf })}`).then((r) => r.json()).then((o) => o.candles?.length && setCandles(o.candles)).catch(() => {});
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tf]);

  return (
    <div className="space-y-4">
      {multi ? <ConsensusStrip m={multi} /> : null}

      <Section
        title={title ?? "Chart"}
        right={
          <div className="flex items-center gap-2">
            {meta ? <QualityBadge quality={meta.quality} source={meta.source} note={meta.note} /> : null}
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button key={t} className="btn-ghost" data-active={t === tf} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
          <span className="mx-2 hidden h-5 w-px bg-border sm:block" />
          {(["ema20", "ema50", "sma200", "bollinger", "levels", "setup", "patterns"] as const).map((k) => (
            <button key={k} className="btn-ghost" data-active={!!overlays[k]} onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}>
              {k === "ema20" ? "EMA20" : k === "ema50" ? "EMA50" : k === "sma200" ? "SMA200" : k === "bollinger" ? "BB" : k}
            </button>
          ))}
        </div>
        {loading && !candles.length ? <div className="h-[420px] animate-pulse rounded-lg bg-bg-3" /> : candles.length ? <PriceChart candles={candles} analysis={analysis} overlays={overlays} /> : <Empty>{err ?? "No chart data for this timeframe."}</Empty>}
        {meta?.note ? <p className="mt-2 text-xs text-amber">{meta.note}</p> : null}
      </Section>

      {analysis ? <TimeframeReport a={analysis} asset={asset} /> : !loading ? <Empty>Not enough candle history on {tf} to analyze (need ≥60 candles).</Empty> : null}
    </div>
  );
}

function ConsensusStrip({ m }: { m: MultiTfAnalysis }) {
  const c = m.consensus;
  const cls = c.alignment === "aligned bullish" ? "border-mint" : c.alignment === "aligned bearish" ? "border-red" : c.alignment === "conflicting" ? "border-amber" : "border-border";
  return (
    <div className={`card border-l-4 p-4 ${cls}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-fg-3">Multi-timeframe</span>
        <span className="pill pill-gray">short-term (15m/1h)</span> <OutlookBadge outlook={c.shortTerm} />
        <span className="pill pill-gray">long-term (4h/1d)</span> <OutlookBadge outlook={c.longTerm} />
        <span className="ml-auto text-xs text-fg-2">
          Opportunity <b className="num text-fg">{c.opportunityScore}</b>/100
        </span>
      </div>
      <p className="mt-2 text-sm text-fg-2">{c.summary}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(m.timeframes).map(([tf, t]) => (
          <span key={tf} className="num text-xs text-fg-3">
            {tf}: {"unavailable" in t ? "n/a" : <span className={t.score > 0 ? "up" : t.score < 0 ? "down" : ""}>{t.score > 0 ? "+" : ""}{t.score}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function TimeframeReport({ a, asset }: { a: TimeframeAnalysis; asset: AssetQuery }) {
  const groups = ["trend", "momentum", "volume", "volatility", "structure", "pattern"] as const;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={`${a.timeframe} outlook`} className="lg:col-span-2" right={<OutlookBadge outlook={a.outlook} />}>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Score" v={<span className={a.score > 0 ? "up" : a.score < 0 ? "down" : ""}>{a.score > 0 ? "+" : ""}{a.score}</span>} />
          <Mini label="Trend" v={`${a.trend.direction} (${(a.trend.strength * 100).toFixed(0)}%)`} />
          <Mini label="RSI 14" v={a.momentum.rsi.toFixed(1)} />
          <Mini label="ATR" v={`${(a.volatility.atrPct * 100).toFixed(2)}% · ${a.volatility.regime}`} />
          <Mini label="Volume" v={`${a.volume.ratio.toFixed(2)}× avg · ${a.volume.trend}`} />
          <Mini label="MACD hist" v={<span className={a.momentum.macdHist > 0 ? "up" : "down"}>{fmtNum(a.momentum.macdHist, 4)}</span>} />
          <Mini label="VWAP (50)" v={fmtUsd(a.vwap)} />
          <Mini label="Vol. POC" v={fmtUsd(a.volumePoc)} />
        </div>
        <h3 className="mb-1 text-xs uppercase tracking-wider text-fg-3">Why</h3>
        <ul className="space-y-1.5 text-sm">
          {groups.flatMap((g) =>
            a.reasons
              .filter((r) => r.group === g)
              .map((r, i) => (
                <li key={g + i} className="flex gap-2">
                  <span className={`num w-10 shrink-0 text-right text-xs ${r.weight > 0 ? "up" : r.weight < 0 ? "down" : "text-fg-3"}`}>{r.weight > 0 ? "+" : ""}{r.weight.toFixed(0)}</span>
                  <span className="text-fg-2"><span className="pill pill-gray mr-1">{g}</span>{r.text}</span>
                </li>
              )),
          )}
        </ul>
        {a.breakout.type ? <p className="mt-3 text-sm"><b className={a.breakout.type === "breakout" ? "up" : "down"}>{a.breakout.type.toUpperCase()}</b> — {a.breakout.note}</p> : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="card-3 p-3">
            <div className="mb-1 text-xs font-semibold text-mint">Bullish scenario</div>
            <p className="text-sm text-fg-2">{a.scenarios.bullish}</p>
          </div>
          <div className="card-3 p-3">
            <div className="mb-1 text-xs font-semibold text-red">Bearish scenario</div>
            <p className="text-sm text-fg-2">{a.scenarios.bearish}</p>
          </div>
        </div>
        {a.weakeningMomentum.length || a.reversalSigns.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {a.weakeningMomentum.length ? <List title="Weakening momentum" items={a.weakeningMomentum} /> : null}
            {a.reversalSigns.length ? <List title="Possible reversal signs" items={a.reversalSigns} /> : null}
          </div>
        ) : null}
      </Section>

      <div className="space-y-4">
        {a.setup ? <SetupCard s={a.setup} asset={asset} tf={a.timeframe} score={a.score} /> : (
          <Section title="Trade setup">
            <Empty>No setup on {a.timeframe}: {a.setupReason}</Empty>
          </Section>
        )}
        <Section title="Key levels">
          <table>
            <tbody>
              {[...a.levels].reverse().map((l) => (
                <tr key={l.price}>
                  <td><span className={`pill ${l.kind === "support" ? "pill-mint" : "pill-red"}`}>{l.kind}</span></td>
                  <td className="num">{fmtUsd(l.price)}</td>
                  <td className="num text-fg-3">{l.touches}× · {fmtPct(((l.price - a.price) / a.price) * 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-xs text-fg-3">Fib (last 120 candles)</div>
          <div className="num mt-1 grid grid-cols-4 gap-1 text-xs text-fg-2">
            {a.fib.map((f) => (
              <span key={f.ratio}>{(f.ratio * 100).toFixed(1)}% <span className="text-fg">{fmtUsd(f.price)}</span></span>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Patterns" className="lg:col-span-3">
        <div className="grid gap-3 md:grid-cols-3">
          <PatternCol title="Completed (historical)" items={a.patterns.completed} />
          <PatternCol title="Forming (unconfirmed)" items={a.patterns.forming} />
          <PatternCol title="Potential (speculative)" items={a.patterns.potential} />
        </div>
      </Section>
    </div>
  );
}

function Mini({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div className="card-3 p-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="num mt-0.5 text-sm font-medium">{v}</div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card-3 p-3">
      <div className="mb-1 text-xs font-semibold text-amber">{title}</div>
      <ul className="list-disc space-y-1 pl-4 text-sm text-fg-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function PatternCol({ title, items }: { title: string; items: TimeframeAnalysis["patterns"]["completed"] }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-fg-3">{title}</div>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((p, i) => (
            <li key={p.name + i} className="card-3 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`pill ${p.bias === "bullish" ? "pill-mint" : "pill-red"}`}>{p.bias}</span>
                <b>{p.name}</b>
                <span className="num ml-auto text-xs text-fg-3">{(p.confidence * 100).toFixed(0)}%</span>
              </div>
              <p className="mt-1 text-fg-2">{p.description}</p>
              {p.target ? <p className="num mt-1 text-xs text-fg-3">Measured target {fmtUsd(p.target)}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">None detected.</p>
      )}
    </div>
  );
}

export function SetupCard({ s, asset, tf, score }: { s: Setup; asset: AssetQuery; tf: Timeframe; score?: number }) {
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "guest" | "error">("idle");
  const save = async () => {
    setSaved("saving");
    const sb = supabaseBrowser();
    const user = sb ? (await sb.auth.getUser()).data.user : null;
    if (!user) return setSaved("guest");
    const r = await fetch("/api/me/setups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setup: s, symbol: asset.symbol ?? asset.id ?? "?", timeframe: tf, score, assetKey: asset.id ? `cg:${asset.id}` : asset.pool ? `pool:${asset.network}:${asset.pool}` : `sym:${asset.symbol}` }) });
    setSaved(r.ok ? "saved" : "error");
  };
  const riskHref = `/risk?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: asset.symbol ?? "", tf }).toString()}`;
  return (
    <Section
      title={<span className={s.side === "LONG" ? "up" : "down"}>{s.side} setup · {tf}</span>}
      right={<span className={`pill ${s.kind === "confirmed" ? "pill-mint" : "pill-amber"}`}>{s.kind}</span>}
    >
      <div className="num space-y-1 text-sm">
        <Row k={`Entry (${s.entry.type})`} v={`${fmtUsd(s.entry.low)} – ${fmtUsd(s.entry.high)}`} />
        {s.takeProfits.map((t) => <Row key={t.label} k={t.label} v={<span className="up">{fmtUsd(t.price)} <span className="text-fg-3">({t.rr}R · {t.basis})</span></span>} />)}
        {s.stopLosses.map((t) => <Row key={t.label} k={t.label} v={<span className="down">{fmtUsd(t.price)} <span className="text-fg-3">({fmtPct(t.pctFromEntry, 2)} · {t.basis})</span></span>} />)}
        <Row k="R:R to TP2" v={<b>{s.riskRewardTp2}R</b>} />
        <Row k="Confidence" v={`${s.confidence}%`} />
        <Row k="Style" v={`${s.style} · hold ${s.holdingPeriod}`} />
      </div>
      <p className="mt-2 text-xs text-fg-3">{s.holdingReason}</p>
      <Block title="Reasons" items={s.reasons} />
      <Block title="Invalidated if" items={s.invalidation} tone="down" />
      <Block title="Exit early if" items={s.exitEarlyIf} />
      <Block title="Taking profit" items={s.takeProfitWhen} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={riskHref} className="btn inline-block text-sm">Size this trade →</Link>
        <Link href={`/alerts?${new URLSearchParams({ symbol: asset.symbol ?? "", id: asset.id ?? "", tf, price: String(s.takeProfits[0].price) }).toString()}`} className="btn-ghost">Set alert</Link>
        <button className="btn-ghost" onClick={save} disabled={saved === "saving" || saved === "saved"}>
          {saved === "saved" ? "Saved ✓" : saved === "saving" ? "Saving…" : "Save setup"}
        </button>
        {saved === "guest" ? <Link href="/login" className="text-xs text-amber">Sign in to save setups</Link> : null}
        {saved === "error" ? <span className="text-xs text-red">Save failed</span> : null}
      </div>
    </Section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1 last:border-0">
      <span className="font-sans text-xs text-fg-3">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone?: "down" }) {
  return (
    <div className="mt-3">
      <div className={`text-[11px] uppercase tracking-wider ${tone === "down" ? "text-red" : "text-fg-3"}`}>{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export { pctClass };
