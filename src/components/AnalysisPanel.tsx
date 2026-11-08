"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mergeCandle, subscribeKline } from "@/lib/live";
import { currentVenue, VENUE_EVENT } from "@/lib/venue-pref";
import { VENUE_META, splitInstrument, type VenueId } from "@/lib/venues";
import Link from "next/link";
import PriceChart, { defaultVisiblePatterns, type ChartOverlays } from "./PriceChart";
import type { Pattern } from "@/lib/ta/patterns";
import TradeConditions from "./TradeConditions";
import Backtest from "./Backtest";
import Term from "./Term";
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
  p.set("venue", currentVenue());
  return p.toString();
}

const PREF_KEY = "ashesignal.chart.prefs.v1";
interface ChartPrefs { tf?: Timeframe; overlays?: ChartOverlays }

export default function AnalysisPanel({ asset, defaultTf = "4h", title }: { asset: AssetQuery; defaultTf?: Timeframe; title?: string }) {
  const [tf, setTf] = useState<Timeframe>(() => {
    if (typeof window === "undefined") return defaultTf;
    // A ?tf= in the URL (links from discovery cards, alerts, share cards) wins over the remembered preference.
    const q = new URLSearchParams(window.location.search).get("tf");
    if (q && (TIMEFRAMES as readonly string[]).includes(q)) return q as Timeframe;
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as ChartPrefs; return p.tf ?? defaultTf; } catch { return defaultTf; }
  });
  const [prefSaved, setPrefSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [visible, setVisible] = useState<string[] | null>(null); // null = engine default
  const togglePattern = (id: string) => setVisible((v) => { const cur = new Set(v ?? defaultVisiblePatterns(analysis)); if (cur.has(id)) cur.delete(id); else cur.add(id); return [...cur]; });
  // pull account prefs once (overrides local)
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => {
      const p = j?.profile?.preferences?.chart as ChartPrefs | undefined;
      if (!p) return;
      if (p.tf) setTf(p.tf);
      if (p.overlays) setOverlays((o) => ({ ...o, ...p.overlays }));
      try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
    }).catch(() => {});
  }, []);
  const savePrefs = async () => {
    const p: ChartPrefs = { tf, overlays };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
    setPrefSaved("saving");
    const r = await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { chart: p } }) }).catch(() => null);
    setPrefSaved("saved");
    void r;
    setTimeout(() => setPrefSaved("idle"), 2000);
  };
  const [candles, setCandles] = useState<Candle[]>([]);
  const [meta, setMeta] = useState<{ source: string; quality: string; note?: string; symbol?: string } | null>(null);
  const [analysis, setAnalysis] = useState<TimeframeAnalysis | null>(null);
  const [multi, setMulti] = useState<MultiTfAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<ChartOverlays>(() => {
    const base: ChartOverlays = { ema20: true, ema50: true, sma200: false, bollinger: false, levels: true, setup: true, patterns: true };
    if (typeof window === "undefined") return base;
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as ChartPrefs; return { ...base, ...(p.overlays ?? {}) }; } catch { return base; }
  });
  const [venueTick, setVenueTick] = useState(0);
  useEffect(() => { const on = () => setVenueTick((n) => n + 1); window.addEventListener(VENUE_EVENT, on); return () => window.removeEventListener(VENUE_EVENT, on); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => qs(asset), [asset, venueTick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/analyze?${qs(asset, { tf })}`)
      .then((r) => r.json())
      .then(async (a) => {
        if (!alive) return;
        setAnalysis(a.analysis ?? null);
        setVisible(null);
        setMeta({ source: a.source, symbol: a.symbol, quality: a.quality, note: a.note });
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

  // live ticks via WebSocket when the chart comes from Binance
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (meta?.source !== "binance" || !asset.symbol) {
      setLive(false);
      return;
    }
    let sym: string | null = null;
    let unsub = () => {};
    let alive = true;
    fetch(`/api/ohlcv?${qs(asset, { tf, limit: "1" })}`).then((r) => r.json()).then((o) => {
      if (!alive || o.source !== "binance") return;
      sym = o.symbol;
      unsub = subscribeKline(sym!, tf, (c) => {
        setCandles((prev) => mergeCandle(prev, c));
        setLive(true);
      });
    });
    return () => {
      alive = false;
      unsub();
      setLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.source, key, tf]);

  // refresh the active timeframe periodically (fallback when no live socket; also refreshes analysis)
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
      <TradeConditions query={{ symbol: asset.symbol, id: asset.id, network: asset.network, pool: asset.pool, tf }} />
      {multi ? <ConsensusStrip m={multi} /> : null}

      <Section
        title={title ?? "Chart"}
        right={
          <div className="flex items-center gap-2">
            {live ? <span className="pill pill-mint"><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" /> live</span> : null}
            {meta ? <QualityBadge quality={meta.quality} source={meta.source} note={meta.note} /> : null}
            {meta && VENUE_META[meta.source as VenueId] && meta.symbol ? <a className="link text-xs" target="_blank" rel="noreferrer" href={VENUE_META[meta.source as VenueId].tradeUrl(splitInstrument(meta.source as VenueId, meta.symbol).base, splitInstrument(meta.source as VenueId, meta.symbol).quote)}>Trade {meta.symbol} on {VENUE_META[meta.source as VenueId].label} ↗</a> : null}
          </div>
        }
      >
        <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1 sm:flex-wrap">
          {TIMEFRAMES.map((t) => (
            <button key={t} className="btn-ghost shrink-0" data-active={t === tf} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          {(["ema20", "ema50", "sma200", "bollinger", "levels", "setup", "patterns"] as const).map((k) => (
            <button key={k} className="btn-ghost shrink-0" data-active={!!overlays[k]} onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}>
              {k === "ema20" ? "EMA20" : k === "ema50" ? "EMA50" : k === "sma200" ? "SMA200" : k === "bollinger" ? "BB" : k}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          <button className="btn-ghost shrink-0" onClick={savePrefs} title="Make this timeframe + overlay set the default on every chart (synced to your account when signed in)">{prefSaved === "saved" ? "Default ✓" : prefSaved === "saving" ? "Saving…" : "Set as default"}</button>
        </div>
        {loading && !candles.length ? <div className="h-[300px] animate-pulse rounded-lg bg-bg-3 sm:h-[420px]" /> : candles.length ? <PriceChart candles={candles} analysis={analysis} overlays={overlays} visiblePatterns={visible ?? undefined} /> : <Empty>{err ?? "No chart data for this timeframe."}</Empty>}
        {meta?.note ? <p className="mt-2 text-xs text-amber">{meta.note}</p> : null}
        {analysis && overlays.patterns ? <PatternToggles a={analysis} visible={visible ?? defaultVisiblePatterns(analysis)} onToggle={togglePattern} onAll={(on) => setVisible(on ? analysis.patterns.all.map((p) => p.id) : [])} /> : null}
      </Section>

      {analysis ? <TimeframeReport a={analysis} asset={asset} /> : !loading ? <Empty>Not enough candle history on {tf} to analyze (need at least 60 candles).</Empty> : null}
      {analysis ? <Backtest asset={asset} tf={tf} /> : null}
    </div>
  );
}

function ConsensusStrip({ m }: { m: MultiTfAnalysis }) {
  const c = m.consensus;
  const cls = c.alignment === "aligned bullish" ? "border-mint" : c.alignment === "aligned bearish" ? "border-red" : c.alignment === "conflicting" ? "border-amber" : "border-border";
  return (
    <div className={`card border-l-4 p-4 ${cls}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Term id="alignment" className="text-xs uppercase tracking-wider text-fg-3">Multi-timeframe</Term>
        <span className="pill pill-gray">short-term (15m/1h)</span> <OutlookBadge outlook={c.shortTerm} />
        <span className="pill pill-gray">long-term (4h/1d)</span> <OutlookBadge outlook={c.longTerm} />
        <span className="ml-auto text-xs text-fg-2">
          <Term id="opportunity">Opportunity</Term> <b className="num text-fg">{c.opportunityScore}</b>/100
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
          <Mini label={<Term id="score">Score</Term>} v={<span className={a.score > 0 ? "up" : a.score < 0 ? "down" : ""}>{a.score > 0 ? "+" : ""}{a.score}</span>} />
          <Mini label="Trend" v={`${a.trend.direction} (${(a.trend.strength * 100).toFixed(0)}%)`} />
          <Mini label={<Term id="rsi">RSI 14</Term>} v={a.momentum.rsi.toFixed(1)} />
          <Mini label={<Term id="atr">ATR</Term>} v={`${(a.volatility.atrPct * 100).toFixed(2)}% · ${a.volatility.regime}`} />
          <Mini label="Volume" v={`${a.volume.ratio.toFixed(2)}× avg · ${a.volume.trend}`} />
          <Mini label={<Term id="macd">MACD hist</Term>} v={<span className={a.momentum.macdHist > 0 ? "up" : "down"}>{fmtNum(a.momentum.macdHist, 4)}</span>} />
          <Mini label={<Term id="vwap">VWAP (50)</Term>} v={fmtUsd(a.vwap)} />
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
        {a.breakout.type ? <p className="mt-3 text-sm"><b className={a.breakout.type === "breakout" ? "up" : "down"}>{a.breakout.type.toUpperCase()}</b> - {a.breakout.note}</p> : null}
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
            <Empty>Not enough candle history on {a.timeframe} to compute targets.</Empty>
          </Section>
        )}
        <Section title="Key levels">
          <div className="table-scroll">
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
          </div>
          <div className="mt-3 text-xs text-fg-3">Fib (last 120 candles)</div>
          <div className="num mt-1 grid grid-cols-4 gap-1 text-xs text-fg-2">
            {a.fib.map((f) => (
              <span key={f.ratio}>{(f.ratio * 100).toFixed(1)}% <span className="text-fg">{fmtUsd(f.price)}</span></span>
            ))}
          </div>
        </Section>
      </div>

      <Section title={`Patterns on ${a.timeframe}`} className="lg:col-span-3" right={<span className="text-[11px] text-fg-3">detected on this timeframe only; other timeframes are analyzed independently</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PatternCol title="Confirmed (trigger broken, holding)" items={a.patterns.confirmed} tf={a.timeframe} />
          <PatternCol title="Forming (unconfirmed)" items={a.patterns.forming} tf={a.timeframe} />
          <PatternCol title="Completed (target reached)" items={a.patterns.completed} tf={a.timeframe} />
          <PatternCol title="Failed / invalidated" items={[...a.patterns.failed, ...a.patterns.invalidated]} tf={a.timeframe} />
        </div>
      </Section>
    </div>
  );
}

function Mini({ label, v }: { label: React.ReactNode; v: React.ReactNode }) {
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

function PatternCol({ title, items, tf }: { title: string; items: Pattern[]; tf: Timeframe }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-fg-3">{title}</div>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((p) => {
            const dead = p.status === "failed" || p.status === "invalidated";
            return (
              <li key={p.id} className="card-3 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${dead ? "pill-gray" : p.bias === "bullish" ? "pill-mint" : "pill-red"}`}>{p.bias === "bullish" ? "▲ bullish" : "▼ bearish"}</span>
                  <b>{p.name}</b>
                  <span className="pill pill-gray">{p.family}</span>
                  <span className="pill pill-gray">{tf}</span>
                  <span className="num ml-auto text-xs text-fg-3">{Math.round(p.confidence * 100)}%</span>
                </div>
                <p className="mt-1 text-fg-2">{p.description}</p>
                <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-fg-3">
                  {p.keyLevel != null ? <span>trigger {fmtUsd(p.keyLevel)}</span> : null}
                  {p.target != null ? <span>target {fmtUsd(p.target)}</span> : null}
                  {p.invalidation != null ? <span>invalid {fmtUsd(p.invalidation)}</span> : null}
                  <span>{new Date(p.startTime * 1000).toLocaleDateString()} to {new Date(p.endTime * 1000).toLocaleDateString()}</span>
                </div>
                {p.criteria.length ? <p className="mt-1 text-[11px] text-fg-3">confidence from: {p.criteria.join(" · ")}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">None detected.</p>
      )}
    </div>
  );
}

function PatternToggles({ a, visible, onToggle, onAll }: { a: TimeframeAnalysis; visible: string[]; onToggle: (id: string) => void; onAll: (on: boolean) => void }) {
  const live = a.patterns.all.filter((p) => p.family !== "candlestick");
  const sticks = a.patterns.all.filter((p) => p.family === "candlestick");
  if (!a.patterns.all.length) return <p className="mt-2 text-xs text-fg-3">No chart patterns detected on {a.timeframe}.</p>;
  const vis = new Set(visible);
  const chip = (p: Pattern) => {
    const dead = p.status === "failed" || p.status === "invalidated";
    const on = vis.has(p.id);
    const tone = dead ? "chip-gray" : p.bias === "bullish" ? "chip-mint" : "chip-red";
    return (
      <button key={p.id} onClick={() => onToggle(p.id)} className={`chip ${tone}`} data-on={on} title={p.description}>
        <span>{p.bias === "bullish" ? "▲" : "▼"}</span>
        <span className="chip-name">{p.name}</span>
        <span className="chip-meta">{p.status} · {Math.round(p.confidence * 100)}%</span>
      </button>
    );
  };
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wider text-fg-3">Overlays on {a.timeframe}</span>
        {live.map(chip)}
        <span className="ml-auto flex gap-1 text-[11px]"><button className="link" onClick={() => onAll(true)}>all</button><span className="text-fg-3">/</span><button className="link" onClick={() => onAll(false)}>none</button></span>
      </div>
      {sticks.length ? <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[11px] uppercase tracking-wider text-fg-3">Candles</span>{sticks.map(chip)}</div> : null}
      <p className="text-[11px] text-fg-3">Solid = confirmed, dashed = forming, dotted grey = failed or invalidated (<Term id="pattern-status">what these mean</Term>). Labels mark where each pattern starts; arrows mark its direction at the latest bar.</p>
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
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const lines = [
      `${asset.symbol ?? asset.id ?? ""} ${s.side} (${s.kind}) on ${tf} - AsheSignal`,
      `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)} (${s.entry.type})`,
      ...s.takeProfits.map((t) => `${t.label}: ${fmtUsd(t.price)} (${t.rr}R)`),
      ...s.stopLosses.map((t) => `${t.label}: ${fmtUsd(t.price)} (${fmtPct(t.pctFromEntry, 2)})`),
      `R:R to TP2 ${s.riskRewardTp2}R - leverage ${s.leverage.recommended}x (safe ${s.leverage.conservative}x, max ${s.leverage.maxSafe}x) - confidence ${s.confidence}% - ${s.style}, hold ${s.holdingPeriod}`,
      `Invalidated if: ${s.invalidation.join(" ")}`,
      "Not financial advice.",
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const riskHref = `/risk?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: asset.symbol ?? "", tf, leverage: String(s.leverage.recommended) }).toString()}`;
  const guideHref = `/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0].price), stop2: String(s.stopLosses[1]?.price ?? ""), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: asset.symbol ?? "", leverage: String(s.leverage.recommended) }).toString()}`;
  return (
    <Section
      title={<span className={s.side === "LONG" ? "up" : "down"}>{s.side} {s.kind === "watch" ? "levels" : "setup"} · {tf}</span>}
      right={<Term id="setup-kind" className={`pill ${s.kind === "confirmed" ? "pill-mint" : s.kind === "speculative" ? "pill-amber" : "pill-gray"}`}>{s.kind === "watch" ? "watch - not a trade yet" : s.kind}</Term>}
    >
      {s.kind === "watch" ? (
        <div className="mb-2 rounded-lg border border-border bg-bg-3 p-2 text-xs text-fg-2">
          <b className="text-fg">Targets are computed from the chart structure, but the engine does not rate this a trade yet:</b>
          <ul className="mt-1 list-disc pl-4">{s.quality.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ) : null}
      {s.kind === "speculative" && s.quality.confirmGaps?.length ? (
        <div className="mb-2 rounded-lg border border-amber/40 bg-amber-dim p-2 text-xs text-fg-2">
          <b className="text-fg">Speculative, not confirmed. Still missing:</b>
          <ul className="mt-1 list-disc pl-4">{s.quality.confirmGaps.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ) : null}
      <div className="num space-y-1 text-sm">
        <Row k={<Term id="entry">{`Entry (${s.entry.type})`}</Term>} v={`${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`} />
        {s.takeProfits.map((t) => <Row key={t.label} k={<Term id="tp">{t.label}</Term>} v={<span className="up">{fmtUsd(t.price)} <span className="text-fg-3">({t.rr}R · {t.basis}{t.reliable ? "" : " · estimate"})</span></span>} />)}
        {s.stopLosses.map((t) => <Row key={t.label} k={<Term id="sl">{t.label}</Term>} v={<span className="down">{fmtUsd(t.price)} <span className="text-fg-3">({fmtPct(t.pctFromEntry, 2)} · {t.basis}{t.reliable ? "" : " · estimate"})</span></span>} />)}
        <Row k={<Term id="rr">R:R to TP2</Term>} v={<b>{s.riskRewardTp2}R</b>} />
        <Row k={<Term id="leverage">Leverage</Term>} v={<span><b className={s.leverage.recommended > 1 ? "up" : ""}>{s.leverage.recommended}x</b> <span className="text-fg-3">rec · {s.leverage.conservative}x safe · {s.leverage.aggressive}x max · liq at {s.leverage.liquidationPctAtRecommended}% vs stop {s.leverage.stopDistancePct}%</span></span>} />
        <Row k={<Term id="confidence">Confidence</Term>} v={`${s.confidence}%`} />
        <Row k={<Term id="holding">Style</Term>} v={`${s.style} · hold ${s.holdingPeriod}`} />
      </div>
      <p className="mt-2 text-xs text-fg-3">{s.holdingReason}</p>
      <Block title="Why this leverage" items={s.leverage.rationale} />
      <Block title="Reasons" items={s.reasons} />
      <Block title={<Term id="invalidation">Invalidated if</Term>} items={s.invalidation} tone="down" />
      <Block title="Exit early if" items={s.exitEarlyIf} />
      <Block title="Taking profit" items={s.takeProfitWhen} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={riskHref} className="btn inline-block text-sm">Size this trade →</Link>
        <Link href={guideHref} className="btn-ghost inline-block text-sm" title="Click-by-click steps to place this setup on your exchange">How to place it</Link>
        <Link href={`/alerts?${new URLSearchParams({ symbol: asset.symbol ?? "", id: asset.id ?? "", tf, price: String(s.takeProfits[0].price) }).toString()}`} className="btn-ghost">Set alert</Link>
        <button className="btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <a className="btn-ghost" target="_blank" rel="noreferrer" href={`/api/og?${new URLSearchParams({ symbol: asset.symbol ?? asset.id ?? "", tf, side: s.side, kind: s.kind, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), sl1: String(s.stopLosses[0].price), sl2: String(s.stopLosses[1].price), rr: String(s.riskRewardTp2), lev: String(s.leverage.recommended), conf: String(s.confidence), style: s.style, theme: typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") ?? "foundry" : "foundry" }).toString()}`}>Share card</a>
        <button className="btn-ghost" onClick={save} disabled={saved === "saving" || saved === "saved"}>
          {saved === "saved" ? "Saved ✓" : saved === "saving" ? "Saving…" : "Save setup"}
        </button>
        {saved === "guest" ? <Link href="/login" className="text-xs text-amber">Sign in to save setups</Link> : null}
        {saved === "error" ? <span className="text-xs text-red">Save failed</span> : null}
      </div>
    </Section>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1 last:border-0">
      <span className="font-sans text-xs text-fg-3">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function Block({ title, items, tone }: { title: React.ReactNode; items: string[]; tone?: "down" }) {
  return (
    <div className="mt-3">
      <div className={`text-[11px] uppercase tracking-wider ${tone === "down" ? "text-red" : "text-fg-3"}`}>{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export { pctClass };
