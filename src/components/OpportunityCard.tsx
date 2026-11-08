"use client";

import { useState } from "react";
import Link from "next/link";
import { RiskBadge } from "@/components/ui";
import { fmtPct, fmtUsd, pctClass, timeAgo } from "@/lib/format";
import type { Opportunity } from "@/lib/market/opportunities";
import Term from "@/components/Term";
import TakeTradeDialog from "@/components/TakeTradeDialog";
import CalibrationBadge from "@/components/CalibrationBadge";
import { currentVenue } from "@/lib/venue-pref";
import { VENUE_META, isVenueId, tradeLink } from "@/lib/venues";

/* eslint-disable @typescript-eslint/no-explicit-any */

function KV({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) {
  return <div className="flex items-baseline justify-between gap-2 text-xs"><span className="text-fg-3">{k}</span><span className={`num text-right ${cls}`}>{v}</span></div>;
}
function Block({ title, children, tone = "" }: { title: string; children: React.ReactNode; tone?: string }) {
  return <div className={`rounded-lg border border-border bg-bg-2 p-2.5 ${tone}`}><div className="mb-1 text-[10px] uppercase tracking-wider text-fg-3">{title}</div><div className="space-y-1 text-xs leading-relaxed">{children}</div></div>;
}
function List({ items, bullet = "·" }: { items: string[]; bullet?: string }) {
  return <ul className="space-y-0.5">{items.map((x, i) => <li key={i} className="flex gap-1.5"><span className="text-fg-3">{bullet}</span><span>{x}</span></li>)}</ul>;
}

export function copyTradeText(o: Opportunity): string {
  const d: any = o.detail; const s = d?.setup; const sp = o.spec; const st = o.spot;
  const venue = currentVenue();
  const lines: string[] = [`${o.symbol} (${o.name}) - ${o.category.toUpperCase()} - AsheSignal`];
  const tv = o.venues?.length ? o.venues[0] : venue;
  if (o.category !== "speculative") lines.push(`Pair on ${VENUE_META[tv].label}: ${VENUE_META[tv].instrument(o.symbol, VENUE_META[tv].quotes[0])} - ${tradeLink(tv, o.symbol)}${o.venues?.length ? ` (also on: ${o.venues.slice(1).map((v) => VENUE_META[v].label).join(", ") || "none of the others"})` : ""}`);
  if (s) {
    lines.push(`Direction: ${s.side}${o.category === "watching" ? " (NOT confirmed yet, provisional levels)" : ""}`);
    lines.push(`Timeframe: ${o.timeframe}`);
    lines.push(`Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)} (${s.entry.type})`);
    for (const t of s.takeProfits) lines.push(`${t.label}: ${fmtUsd(t.price)} (${t.rr}R)${t.reliable ? "" : " [low reliability]"}`);
    for (const t of s.stopLosses) lines.push(`${t.label}: ${fmtUsd(t.price)}`);
    lines.push(`R:R to TP2: ${s.rr}R - Confidence: ${s.confidence}%`);
    if (s.leverage) lines.push(`Leverage: ${s.leverage.recommended}x recommended (conservative ${s.leverage.conservative}x, max ${s.leverage.maxSafe}x)`);
    lines.push(`Position sizing: risk 1% of account between entry and SL1; size = (account x 0.01) / |entry - SL1|`);
    if (s.invalidation?.length) lines.push(`Invalidated if: ${s.invalidation.join(" ")}`);
  } else if (sp) {
    lines.push(`Chain: ${o.chain} - Price: ${fmtUsd(o.price)} - Liquidity: ${fmtUsd(o.liquidity, { compact: true })} - Risk: ${o.risk}`);
    if (sp.targets.justified && sp.targets.side) {
      lines.push(`Direction: ${sp.targets.side} (speculative)`);
      for (const t of sp.targets.tp) lines.push(`${t.label}: ${fmtUsd(t.price)}`);
      for (const t of sp.targets.sl) lines.push(`${t.label}: ${fmtUsd(t.price)}`);
    } else lines.push(`No technical targets: ${sp.targets.note}`);
    lines.push(`Entry zone: ${sp.zones.entry}`);
    lines.push(`Exit zone: ${sp.zones.exit}`);
    lines.push(`Position sizing: speculative, size only what you can lose entirely (typically 0.25% to 0.5% of account)`);
  } else if (st) {
    lines.push(`Spot (buy and hold) - tier ${st.tier} - score ${st.score}/100`);
    lines.push(`Price: ${fmtUsd(st.analysis.price)}`);
    lines.push(`Accumulation zone: ${fmtUsd(st.analysis.accumulation.low)} - ${fmtUsd(st.analysis.accumulation.high)}`);
    for (const p of st.analysis.profitTaking) lines.push(`Profit taking - ${p.label}: ${fmtUsd(p.price)}`);
    lines.push(`Bull: ${st.analysis.scenarios.bull.range} - Base: ${st.analysis.scenarios.base.range} - Bear: ${st.analysis.scenarios.bear.range}`);
    lines.push(`Position sizing: ${st.tier === "established" ? "core allocation, DCA" : st.tier === "emerging" ? "satellite allocation, DCA" : "small speculative allocation"}`);
  }
  lines.push("Manual trading only. Not financial advice.");
  return lines.join("\n");
}

export default function OpportunityCard({ o }: { o: Opportunity }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hist, setHist] = useState<any[] | null>(null);
  const [taking, setTaking] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(copyTradeText(o)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const loadHist = async () => { if (hist) { setHist(null); return; } const r = await fetch(`/api/opportunities/history?asset=${encodeURIComponent(o.assetKey)}`); setHist((await r.json()).rows ?? []); };
  const tone = o.category === "confirmed" ? "opp-card-green" : o.category === "speculative" ? "opp-card-amber" : o.category === "spot" ? "opp-card-violet" : "opp-card-blue";
  const d: any = o.detail; const s = d?.setup; const spec = o.spec;

  return (
    <article className={`card opp-card ${tone}`}>
      <header className="flex flex-wrap items-center gap-2 p-3">
        <span className="opp-dot" aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">{o.symbol}</span><span className="truncate text-xs text-fg-3">{o.name}</span>{o.category === "speculative" && o.chain ? <span className="pill pill-gray">{o.chain}</span> : null}{o.tier ? <span className="pill pill-gray">{o.tier}</span> : null}{(o.venues ?? []).map((v) => <span key={v} className={`pill ${v === o.venues[0] && isVenueId(currentVenue()) && v === currentVenue() ? "pill-mint" : "pill-gray"}`} title={`Listed on ${VENUE_META[v].label}`}>{VENUE_META[v].label}</span>)}{o.category !== "speculative" && o.venues && !o.venues.length ? <span className="pill pill-amber" title="Not on any of the five supported exchanges; DEX only">DEX only</span> : null}</div>
          <div className="num text-xs text-fg-2">{fmtUsd(o.price)}{o.marketCap ? <span className="text-fg-3"> · mcap {fmtUsd(o.marketCap, { compact: true })}</span> : null}{o.volume24h ? <span className="text-fg-3"> · vol {fmtUsd(o.volume24h, { compact: true })}</span> : null}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          {o.side ? <span className={`pill ${o.side === "LONG" ? "pill-mint" : "pill-red"}`}>{o.side}</span> : <span className={`pill ${o.bias === "bullish" ? "pill-mint" : o.bias === "bearish" ? "pill-red" : "pill-gray"}`}>{o.bias}</span>}
          {o.timeframe ? <span className="pill pill-gray">{o.timeframe}</span> : null}
          <RiskBadge level={o.risk} />
          {o.confidence != null ? (o.category === "spot" || o.category === "speculative" ? <span className="pill pill-gray num">{o.category === "spot" ? "score" : "conf"} {o.confidence}</span> : <CalibrationBadge confidence={o.confidence} kind={o.category === "confirmed" ? "confirmed" : "speculative"} />) : null}
          {o.rr != null ? <span className="pill pill-gray num">{o.rr}R</span> : null}
        </div>
      </header>

      {o.side === "SHORT" && !VENUE_META[currentVenue()].canShort ? <div className="mx-3 mb-2 rounded border border-amber/40 bg-amber-dim px-2 py-1 text-[11px] text-amber">{VENUE_META[currentVenue()].label} is spot only: this SHORT cannot be opened there. If you hold {o.symbol}, treat it as a sell / reduce signal.</div> : null}
      {/* summary line */}
      <div className="px-3 pb-2 text-xs text-fg-2">
        {o.category === "confirmed" && d?.qualifies?.[0] ? d.qualifies[0] : null}
        {o.category === "watching" && d?.watch?.[0] ? <><span className="text-fg-3">Watching: </span>{d.watch[0].what}</> : null}
        {o.category === "speculative" && o.spec ? o.spec.attention[0] : null}
        {o.category === "spot" && o.spot ? o.spot.why.interesting.split(". ")[0] + "." : null}
      </div>

      {open ? <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">{o.category === "spot" && o.spot ? <SpotBody o={o} /> : o.category === "speculative" && o.spec ? <SpecBody o={o} /> : <TaBody o={o} />}</div> : null}

      <footer className="space-y-2 border-t border-border px-3 py-2 text-xs">
        {/* primary actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => setOpen((v) => !v)}>{open ? "Less" : "Details and why"}</button>
          {s || spec || o.spot ? <button className={o.category === "confirmed" ? "btn" : "btn-ghost"} onClick={() => setTaking(true)} title="Record the trade you placed on your exchange in the journal. Nothing is sent to any exchange.">{o.spot ? "I bought (spot)" : "I took this trade"}</button> : null}
          <button className="btn-ghost" onClick={copy} title="Copies direction, entry, TPs, SLs, sizing to your clipboard. Nothing is sent to any exchange.">{copied ? "Copied" : "Copy Trade Setup"}</button>
          {o.category === "spot" ? <Link className="btn-ghost" href={`/alerts?symbol=${encodeURIComponent(o.symbol)}&asset=${encodeURIComponent(o.assetKey)}&type=spot_zone`}>Alert me in the zone</Link> : null}
          <span className="ml-auto text-fg-3">{timeAgo(Date.parse(o.updatedAt))}</span>
        </div>
        {/* secondary actions */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Link className="link" href={o.href}>Full analysis</Link>
          {o.category !== "speculative" && o.venues?.length ? <a className="link" target="_blank" rel="noreferrer" href={tradeLink(o.venues[0], o.symbol)} title={o.venues[0] === currentVenue() ? "Opens the spot pair on your active exchange in a new tab. You place the order yourself." : `Not listed on your active exchange; opens on ${VENUE_META[o.venues[0]].label} instead.`}>Open on {VENUE_META[o.venues[0]].label} ↗</a> : null}
          {s ? <Link className="link" href={`/risk?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), stop: String(s.stopLosses[0]?.price ?? ""), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), symbol: o.symbol, tf: o.timeframe ?? "", leverage: String(s.leverage?.recommended ?? 1) })}`}>Size it</Link> : null}
          {s ? <Link className="link" href={`/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0]?.price ?? ""), stop2: String(s.stopLosses[1]?.price ?? ""), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), symbol: o.symbol, leverage: String(s.leverage?.recommended ?? 1), venue: o.venues?.[0] ?? currentVenue() })}`}>How to place it</Link> : null}
          <button className="link" onClick={loadHist}>{hist ? "Hide history" : "History"}</button>
          <span className="text-fg-3">in category {timeAgo(Date.parse(o.firstSeen))}</span>
        </div>
      </footer>
      {taking && s ? <TakeTradeDialog setup={{ side: s.side, kind: o.category === "confirmed" ? "confirmed" : s.kind === "confirmed" ? "watch" : s.kind, entry: s.entry, takeProfits: s.takeProfits, stopLosses: s.stopLosses, rr: s.rr, confidence: s.confidence, leverage: s.leverage }} symbol={o.symbol} timeframe={o.timeframe ?? "4h"} assetKey={o.assetKey} score={d?.score ?? null} onClose={() => setTaking(false)} /> : null}
      {taking && o.spot ? <TakeTradeDialog setup={{ side: "LONG", kind: "spot", entry: { low: o.spot.analysis.accumulation.low, high: o.spot.analysis.accumulation.high, mid: o.price ?? o.spot.analysis.price }, takeProfits: o.spot.analysis.profitTaking.slice(0, 3).map((t) => ({ price: t.price })), stopLosses: [{ price: o.spot.analysis.accumulation.low * 0.85 }], rr: null as unknown as number, confidence: o.spot.score, leverage: null }} symbol={o.symbol} timeframe="1w" assetKey={o.assetKey} score={o.spot.score} onClose={() => setTaking(false)} /> : null}
      {taking && !s && !o.spot && spec ? <TakeTradeDialog setup={{ side: spec.targets.side ?? "LONG", kind: "speculative", entry: { low: o.price ?? 0, high: o.price ?? 0, mid: o.price ?? 0 }, takeProfits: spec.targets.justified ? spec.targets.tp.map((t) => ({ price: t.price })) : [], stopLosses: spec.targets.justified ? spec.targets.sl.map((t) => ({ price: t.price })) : [], rr: null as unknown as number, confidence: o.confidence ?? 0, leverage: null }} symbol={o.symbol} timeframe={spec.ta?.timeframe ?? "1h"} assetKey={o.assetKey} score={spec.ta?.score ?? null} onClose={() => setTaking(false)} /> : null}
      {hist ? (
        <div className="border-t border-border px-3 py-2 text-xs">
          {!hist.length ? <span className="text-fg-3">No category changes recorded yet.</span> : (
            <ol className="space-y-1">{hist.map((h) => <li key={h.id} className="flex flex-wrap gap-2"><span className="num text-fg-3">{new Date(h.changed_at).toLocaleString()}</span><span className="pill pill-gray">{h.prev_category ?? "none"} → {h.category}</span>{h.timeframe ? <span className="text-fg-3">{h.timeframe}</span> : null}<span className="text-fg-2">{h.reason}</span></li>)}</ol>
          )}
        </div>
      ) : null}
    </article>
  );
}

function TaBody({ o }: { o: Opportunity }) {
  const d: any = o.detail ?? {}; const s = d.setup;
  const watching = o.category === "watching";
  return (
    <>
      {watching ? (
        <Block title="What the engine is watching" tone="md:col-span-2">
          {(d.watch ?? []).map((w: any, i: number) => (
            <div key={i} className="rounded border border-border p-2">
              <div className="font-medium">{w.what}</div>
              <div className="text-fg-2">Why: {w.why}</div>
              <div className="text-fg-2">Needs: {w.needs}</div>
            </div>
          ))}
        </Block>
      ) : (
        <Block title="Why this qualifies as confirmed" tone="md:col-span-2"><List items={d.qualifies ?? []} bullet="✓" /></Block>
      )}
      {s ? (
        <Block title={watching ? "Provisional levels (if it confirms)" : "Trade levels"}>
          <KV k="Direction" v={s.side} cls={s.side === "LONG" ? "up" : "down"} />
          <KV k="Entry zone" v={`${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`} />
          {s.takeProfits.map((t: any) => <KV key={t.label} k={`${t.label} (${t.rr}R)${t.reliable ? "" : " *"}`} v={fmtUsd(t.price)} cls="up" />)}
          {s.stopLosses.map((t: any) => <KV key={t.label} k={t.label} v={fmtUsd(t.price)} cls="down" />)}
          <KV k="R:R to TP2" v={`${s.rr}R`} />
          <KV k="Confidence" v={`${s.confidence}%`} />
          {s.leverage ? <KV k="Leverage" v={`${s.leverage.recommended}x (max ${s.leverage.maxSafe}x)`} /> : null}
          <KV k="Style / hold" v={`${s.style}, ${s.holdingPeriod}`} />
          {s.takeProfits.some((t: any) => !t.reliable) ? <div className="text-[11px] text-fg-3">* target has lower reliability (thin history or far from structure)</div> : null}
        </Block>
      ) : null}
      <Block title="Evidence">
        <KV k="Trend" v={`${d.trend?.direction ?? "?"}${d.trend?.sma200 != null ? ` · ${d.price > d.trend.sma200 ? "above" : "below"} 200 SMA` : ""}`} />
        <KV k="Momentum" v={`RSI ${d.momentum?.rsi ?? "?"}${d.momentum?.macdCross ? ` · MACD ${d.momentum.macdCross}` : ""}`} />
        <KV k="Volume" v={`${d.volume?.ratio ?? "?"}x avg, ${d.volume?.trend ?? "?"}`} />
        <KV k="Volatility" v={`ATR ${d.volatility?.atrPct ?? "?"}% · ${d.volatility?.regime ?? "?"}`} />
        {o.liquidityNote ? <KV k="Liquidity" v={o.liquidityNote} /> : null}
        {d.breakout?.type ? <KV k="Level" v={d.breakout.note} /> : null}
        {d.indicators?.length ? <div className="pt-1"><div className="text-[10px] uppercase tracking-wider text-fg-3">Top indicators</div><List items={d.indicators} /></div> : null}
      </Block>
      <Block title="Chart patterns">
        {d.patterns?.confirmed?.length ? <div><div className="text-[10px] text-fg-3">Confirmed</div><List items={d.patterns.confirmed.map((p: any) => `${p.name} (${p.bias}, ${Math.round(p.confidence * 100)}%)${p.target ? `, target ${fmtUsd(p.target)}` : ""}`)} bullet="✓" /></div> : null}
        {d.patterns?.forming?.length ? <div><div className="text-[10px] text-fg-3">Forming (not confirmed)</div><List items={d.patterns.forming.map((p: any) => `${p.name} (${p.bias})${p.keyLevel ? `, confirms at ${fmtUsd(p.keyLevel)}` : ""}`)} bullet="◌" /></div> : null}
        {!d.patterns?.confirmed?.length && !d.patterns?.forming?.length ? <span className="text-fg-3">No recognizable pattern on this timeframe.</span> : null}
      </Block>
      <Block title="Scenarios">
        <div><span className="up">Bullish:</span> {d.scenarios?.bullish}</div>
        <div><span className="down">Bearish:</span> {d.scenarios?.bearish}</div>
      </Block>
      {d.record ? <Block title="Engine record on this chart"><div>{d.record.n >= 8 ? <>{d.record.winRate}% winners over the last {d.record.n} signals, {d.record.expectancyR}R per trade (walk-forward backtest of this exact timeframe).</> : <>Only {d.record.n} recent signals: not enough to grade.</>}</div>{d.htf ? <div className="text-fg-2">Higher timeframe {d.htf.timeframe}: trend {d.htf.trend}, score {d.htf.score > 0 ? "+" : ""}{d.htf.score}.</div> : null}</Block> : d.htf ? <Block title="Higher timeframe"><div>{d.htf.timeframe}: trend {d.htf.trend}, score {d.htf.score > 0 ? "+" : ""}{d.htf.score}.</div></Block> : null}
      {d.regimeGap && watching ? <Block title="Market regime gate" tone="md:col-span-2"><div>{d.regimeGap}</div></Block> : null}
      {s?.confirmGaps?.length && watching ? <Block title="What is still missing for Confirmed" tone="md:col-span-2"><List items={s.confirmGaps} bullet="○" /></Block> : null}
      {s?.invalidation?.length ? <Block title="What invalidates this setup" tone="md:col-span-2"><List items={s.invalidation} bullet="✕" />{s.issues?.length ? <div className="pt-1 text-fg-3">Quality notes: {s.issues.join(" ")}</div> : null}</Block> : null}
      <div className="md:col-span-2 text-[11px] text-fg-3">Key levels: {(d.levels ?? []).slice(0, 6).map((l: any) => `${l.kind === "support" ? "S" : "R"} ${fmtUsd(l.price)}`).join(" · ")}. <Term id="setup-kind">Confirmed</Term> means the engine's criteria were met; it is not a guarantee.</div>
    </>
  );
}

function SpecBody({ o }: { o: Opportunity }) {
  const sp = o.spec!;
  return (
    <>
      <Block title="Why it is gaining attention" tone="md:col-span-2"><List items={sp.attention} /></Block>
      <Block title="Momentum">
        <KV k="1h" v={fmtPct(sp.momentum.change1h)} cls={pctClass(sp.momentum.change1h)} />
        <KV k="24h" v={fmtPct(sp.momentum.change24h)} cls={pctClass(sp.momentum.change24h)} />
        <KV k="Buys per sell (24h)" v={sp.momentum.buySellRatio?.toFixed(2) ?? "n/a"} />
        <KV k="Transactions 24h" v={sp.momentum.txns24h.toLocaleString()} />
        <div className="text-fg-2">{sp.momentum.note}</div>
      </Block>
      <Block title="Liquidity, volume, size, age">
        <KV k="Liquidity" v={fmtUsd(sp.liquidity.liquidityUsd, { compact: true })} />
        <KV k="Volume 24h" v={fmtUsd(sp.liquidity.volume24h, { compact: true })} />
        {sp.liquidity.volToLiq != null ? <KV k="Volume / liquidity" v={`${sp.liquidity.volToLiq.toFixed(1)}x`} /> : null}
        <KV k="Market cap" v={fmtUsd(sp.marketCap.marketCap ?? sp.marketCap.fdv, { compact: true })} />
        <KV k="Age" v={sp.age.hours == null ? "unknown" : sp.age.hours < 48 ? `${Math.round(sp.age.hours)} h` : `${Math.round(sp.age.hours / 24)} d`} />
        <div className="text-fg-2">{sp.liquidity.note} {sp.marketCap.note} {sp.age.note}</div>
      </Block>
      <Block title="Potential catalysts"><List items={sp.catalysts} /></Block>
      <Block title="Scenarios">
        <div><span className="up">Bullish:</span> {sp.scenarios.bullish}</div>
        <div><span className="down">Bearish:</span> {sp.scenarios.bearish}</div>
      </Block>
      <Block title="Entry and exit zones">
        <div><span className="text-fg-3">Entry:</span> {sp.zones.entry}</div>
        <div><span className="text-fg-3">Exit:</span> {sp.zones.exit}</div>
      </Block>
      <Block title="Targets">
        {sp.targets.justified ? (
          <>
            <KV k="Direction" v={sp.targets.side ?? ""} cls={sp.targets.side === "LONG" ? "up" : "down"} />
            {sp.targets.tp.map((t) => <KV key={t.label} k={t.label} v={fmtUsd(t.price)} cls="up" />)}
            {sp.targets.sl.map((t) => <KV key={t.label} k={t.label} v={fmtUsd(t.price)} cls="down" />)}
          </>
        ) : null}
        <div className="text-fg-2">{sp.targets.note}</div>
      </Block>
      <Block title="Major risk factors" tone="md:col-span-2"><List items={sp.risks} bullet="!" /></Block>
      <Block title="Contract security" tone="md:col-span-2">
        {sp.security ? (
          <>
            <KV k="GoPlus risk score" v={`${sp.security.score}/100 (lower is better)`} cls={sp.security.score != null && sp.security.score >= 60 ? "down" : sp.security.score != null && sp.security.score <= 25 ? "up" : ""} />
            <div className="text-fg-2">{sp.security.summary}</div>
            {sp.security.flags.length ? <div className="text-fg-2">Flags: {sp.security.flags.join(", ")}</div> : null}
          </>
        ) : <span className="text-fg-3">No security report available for this chain.</span>}
        <div className="flex gap-3 pt-1">{sp.links.dexscreener ? <a className="link" href={sp.links.dexscreener} target="_blank" rel="noreferrer">DexScreener</a> : null}{sp.links.website ? <a className="link" href={sp.links.website} target="_blank" rel="noreferrer">Website</a> : null}</div>
      </Block>
    </>
  );
}

function SpotBody({ o }: { o: Opportunity }) {
  const st = o.spot!; const a = st.analysis; const f = st.fundamentals;
  return (
    <>
      <Block title={`Why it could perform well (${st.tier})`} tone="md:col-span-2">
        <div className="text-fg-3">{st.tierNote}</div>
        <div><span className="text-fg-3">What makes it interesting:</span> {st.why.interesting}</div>
        <div><span className="text-fg-3">Problem it solves:</span> {st.why.problem}</div>
        <div><span className="text-fg-3">Ecosystem:</span> {st.why.ecosystem}</div>
        <div><span className="text-fg-3">Adoption:</span> {st.why.adoption}</div>
        <div><span className="text-fg-3">What drives demand:</span> {st.why.demand}</div>
        <div><span className="text-fg-3">Bull market case:</span> {st.why.bullMarket}</div>
      </Block>
      <Block title="Investment analysis">
        <KV k="Current price" v={fmtUsd(a.price)} />
        <KV k="Accumulation zone" v={`${fmtUsd(a.accumulation.low)} - ${fmtUsd(a.accumulation.high)}`} cls="up" />
        <div className="text-fg-2">{a.accumulation.note}</div>
        <div className="pt-1 text-[10px] uppercase tracking-wider text-fg-3">Buying opportunities</div><List items={a.buyingOpportunities} />
        <div className="pt-1 text-[10px] uppercase tracking-wider text-fg-3">Profit-taking zones</div>
        {a.profitTaking.map((p) => <KV key={p.label} k={p.label} v={`${fmtUsd(p.price)} (+${(((p.price - a.price) / a.price) * 100).toFixed(0)}%)`} />)}
      </Block>
      <Block title="Outlook">
        <div><span className="text-fg-3">Short term:</span> {a.outlook.short}</div>
        <div><span className="text-fg-3">Medium term:</span> {a.outlook.medium}</div>
        <div><span className="text-fg-3">Long term:</span> {a.outlook.long}</div>
      </Block>
      <Block title="Scenarios (ranges, not predictions)" tone="md:col-span-2">
        <div><span className="up">Bull market</span> <span className="num text-fg-2">{a.scenarios.bull.range}</span>: {a.scenarios.bull.text}</div>
        <div><span className="text-fg-2">Base case</span> <span className="num text-fg-2">{a.scenarios.base.range}</span>: {a.scenarios.base.text}</div>
        <div><span className="down">Bear market</span> <span className="num text-fg-2">{a.scenarios.bear.range}</span>: {a.scenarios.bear.text}</div>
      </Block>
      <Block title="Fundamentals">
        <KV k="Rank" v={`#${f.rank ?? "?"}`} />
        <KV k="Market cap / FDV" v={`${fmtUsd(f.marketCap, { compact: true })} / ${fmtUsd(f.fdv, { compact: true })}`} />
        <KV k="Volume / mcap" v={f.volToMcap != null ? `${(f.volToMcap * 100).toFixed(1)}%` : "n/a"} />
        <KV k="Circulating" v={f.circulatingPct != null ? `${f.circulatingPct.toFixed(0)}% of max` : "no cap"} />
        <KV k="From ATH" v={fmtPct(f.athDistancePct)} cls={pctClass(f.athDistancePct)} />
        <KV k="30d / 1y" v={`${fmtPct(f.change30d)} / ${fmtPct(f.change1y)}`} />
        <KV k="vs BTC / ETH (1y)" v={`${f.vsBtc1y != null ? (f.vsBtc1y >= 0 ? "+" : "") + f.vsBtc1y.toFixed(0) : "n/a"} / ${f.vsEth1y != null ? (f.vsEth1y >= 0 ? "+" : "") + f.vsEth1y.toFixed(0) : "n/a"} pts`} />
        {f.categories.length ? <div className="pt-1 text-fg-2">{f.categories.slice(0, 5).join(" · ")}</div> : null}
      </Block>
      <Block title={`Score ${st.score}/100`}>
        {st.scoreParts.map((p) => <div key={p.label}><KV k={p.label} v={`${p.points}/${p.max}`} /><div className="text-[11px] text-fg-3">{p.note}</div></div>)}
      </Block>
      <Block title="Main risks" tone="md:col-span-2"><List items={a.risks} bullet="!" /></Block>
      <div className="md:col-span-2 text-[11px] text-fg-3">Structure: 200-day {fmtUsd(st.structure.sma200d)} · 50-week {fmtUsd(st.structure.sma50w)} · 1y range {fmtUsd(st.structure.weeklyLow)} to {fmtUsd(st.structure.weeklyHigh)}. Narrative: {st.narrativeSource === "engine" ? "engine writer" : st.narrativeSource}. Spot means buying the actual asset, no leverage.</div>
    </>
  );
}
