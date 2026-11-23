import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { ensureEngineConfig } from "@/lib/engine-config";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

/**
 * Candle chart PNG with the setup AND the engine's signals drawn on it: entry zone, TP1-3, SL1-2, EMA 20/50, pattern
 * lines and points (confirmed, forming, completed), the breakout level, and a signal strip (outlook, trend, RSI, MACD,
 * volume, patterns). Used by the Telegram cards, broadcasts and the website's Chart buttons.
 * /api/chart?symbol=SOL&id=solana&tf=4h&side=LONG&entryLow=&entryHigh=&tp1=&tp2=&tp3=&sl1=&sl2=
 * Labels are HTML: the image renderer does not support SVG <text>.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const symbol = (q.get("symbol") ?? "BTC").toUpperCase();
  const tf = (q.get("tf") ?? "4h") as Timeframe;
  const sideQ = q.get("side");
  const dark = q.get("theme") !== "paper";
  const C = dark
    ? { bg: "#0b0f14", panel: "#111821", grid: "#1b2430", fg: "#e6edf3", fg2: "#8da0b3", up: "#36bd94", down: "#f0506e", zone: "rgba(54,189,148,0.18)", zoneS: "rgba(240,80,110,0.18)", amber: "#f2b544", ema20: "#5aa9ff", ema50: "#b48cff", bull: "#36bd94", bear: "#f0506e" }
    : { bg: "#ffffff", panel: "#f3f6f9", grid: "#e5e9ef", fg: "#0f172a", fg2: "#64748b", up: "#0f9d74", down: "#d7263d", zone: "rgba(15,157,116,0.15)", zoneS: "rgba(215,38,61,0.15)", amber: "#b7791f", ema20: "#2563eb", ema50: "#7c3aed", bull: "#0f9d74", bear: "#d7263d" };

  let all: Candle[] = [];
  try { const r = await getOhlcv({ symbol, coingeckoId: q.get("id") ?? undefined }, tf, 300); all = r.candles as Candle[]; } catch { /* drawn empty below */ }
  await ensureEngineConfig().catch(() => {});
  const a = all.length >= 60 ? analyzeTimeframe(tf, all as never) : null;
  const VIEW = 90;
  const candles = all.slice(-VIEW);
  const side = sideQ === "SHORT" ? "SHORT" : sideQ === "LONG" ? "LONG" : a?.setup?.side ?? "LONG";

  // Levels: from the query (the card's setup) or, when absent, from the engine's own setup.
  const s = a?.setup;
  const lv = (k: string, fb?: number | null) => n(k) ?? (fb ?? null);
  const levels = [
    { k: "entryLow", v: lv("entryLow", s?.entry.low) }, { k: "entryHigh", v: lv("entryHigh", s?.entry.high) },
    { k: "tp1", v: lv("tp1", s?.takeProfits[0]?.price) }, { k: "tp2", v: lv("tp2", s?.takeProfits[1]?.price) }, { k: "tp3", v: lv("tp3", s?.takeProfits[2]?.price) },
    { k: "sl1", v: lv("sl1", s?.stopLosses[0]?.price) }, { k: "sl2", v: lv("sl2", s?.stopLosses[1]?.price) },
  ].filter((x) => x.v != null) as { k: string; v: number }[];

  // EMA 20 / 50 over the full history, shown over the visible window.
  const ema = (period: number) => { const k = 2 / (period + 1); const out: number[] = []; let e = all[0]?.close ?? 0; for (let i = 0; i < all.length; i++) { e = i === 0 ? all[i].close : all[i].close * k + e * (1 - k); out.push(e); } return out.slice(-VIEW); };
  const e20 = all.length >= 25 ? ema(20) : [], e50 = all.length >= 55 ? ema(50) : [];

  // Patterns worth drawing: confirmed first, then forming, then recently completed; max 3.
  const pats = a ? [...a.patterns.confirmed, ...a.patterns.forming, ...a.patterns.completed].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).slice(0, 3) : [];

  // Layout: header, plot, signal strip.
  const W = 1200, H = 630, padL = 20, padR = 130, padT = 64, stripH = 92, padB = stripH + 18;
  const plotW = W - padL - padR, plotH = H - padT - padB, plotR = padL + plotW;
  const t0 = candles[0]?.time ?? 0;
  const interval = candles.length > 1 ? (candles[candles.length - 1].time - t0) / (candles.length - 1) : 1;
  // Candles use the left 82% of the plot; the right part stays empty for the TP / SL badges and pattern ends.
  const candleW = plotW * 0.82;
  const cw = candles.length ? candleW / candles.length : 10;
  const xOf = (t: number) => padL + ((t - t0) / (interval || 1)) * cw + cw / 2;
  const last = candles.at(-1)?.close ?? null;
  // y range: candles + levels + pattern geometry inside the window (kept within 35% of price so far targets do not squash the chart)
  const near = (p: number) => !last || Math.abs(p - last) / last <= 0.35;
  const patVals = pats.flatMap((p) => [...p.lines.flatMap((l) => [l.from, l.to]), ...p.points].filter((pt) => pt.time >= t0).map((pt) => pt.price)).filter(near);
  const vals = [...candles.flatMap((c) => [c.high, c.low]), ...levels.map((l) => l.v).filter(near), ...patVals, ...(a?.breakout.level && near(a.breakout.level) ? [a.breakout.level] : [])];
  const lo0 = vals.length ? Math.min(...vals) : 0, hi0 = vals.length ? Math.max(...vals) : 1;
  const span = (hi0 - lo0) || 1; const lo = lo0 - span * 0.04, hi = hi0 + span * 0.04;
  const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
  const inY = (p: number) => p >= lo && p <= hi;
  const money = (v: number) => (v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(4)}`);
  const get = (k: string) => levels.find((l) => l.k === k)?.v ?? null;
  const eL = get("entryLow"), eH = get("entryHigh");
  const gridLines = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const lineColor = (k: string) => (k.startsWith("tp") ? C.up : k.startsWith("sl") ? C.down : C.amber);

  // Clip a segment to the plot area (x) so lines that start before the window still show their visible part.
  const clip = (x1: number, y1: number, x2: number, y2: number) => {
    if (x2 < x1) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    if (x2 < padL || x1 > plotR) return null;
    const at = (x: number) => y1 + ((y2 - y1) * (x - x1)) / ((x2 - x1) || 1);
    const ax = Math.max(x1, padL), bx = Math.min(x2, plotR);
    return { x1: ax, y1: at(ax), x2: bx, y2: at(bx) };
  };
  const patColor = (b: string) => (b === "bullish" ? C.bull : C.bear);
  const patLines = pats.flatMap((p, pi) => p.lines.map((l, li) => {
    const seg = clip(xOf(l.from.time), y(l.from.price), xOf(l.to.time), y(l.to.price));
    if (!seg || !inY(l.from.price) && !inY(l.to.price)) return null;
    return { key: `${pi}-${li}`, ...seg, color: patColor(p.bias), dash: l.kind === "target" || l.kind === "invalidation" ? "6 6" : l.kind === "trigger" || l.kind === "neckline" ? "10 4" : undefined, width: l.kind === "trendline" || l.kind === "boundary" ? 2.5 : 2 };
  }).filter(Boolean)) as { key: string; x1: number; y1: number; x2: number; y2: number; color: string; dash?: string; width: number }[];
  const patPoints = pats.flatMap((p, pi) => p.points.filter((pt) => pt.time >= t0 && inY(pt.price)).slice(-6).map((pt, k) => ({ key: `${pi}-${k}`, x: xOf(pt.time), y: y(pt.price), label: pt.label, side: pt.side, color: patColor(p.bias) })));
  // Name tag for each pattern at the right end of its geometry.
  // Name tags: kept clear of the TP/SL badges on the right and of each other.
  const placed: { x: number; y: number; w: number }[] = [];
  const badgeYs = levels.filter((l) => l.k !== "entryLow" && l.k !== "entryHigh" && inY(l.v)).map((l) => y(l.v));
  const patTags = pats.map((p, pi) => {
    const pts = [...p.lines.flatMap((l) => [l.from, l.to]), ...p.points].filter((pt) => pt.time >= t0 && inY(pt.price));
    if (!pts.length) return null;
    const endPt = pts.reduce((m, pt) => (pt.time > m.time ? pt : m), pts[0]);
    const text = `${p.name} · ${p.status}`;
    const w = text.length * 8 + 16;
    const x = Math.min(Math.max(xOf(endPt.time) - w / 2, padL + 4), plotR - 160 - w);
    let ty = Math.min(Math.max(padT + 2, y(endPt.price) - 32), padT + plotH - 26);
    for (let guard = 0; guard < 12; guard++) {
      const hitTag = placed.some((o) => Math.abs(o.y - ty) < 26 && x < o.x + o.w && o.x < x + w);
      const hitBadge = x + w > plotR - 160 && badgeYs.some((by) => Math.abs(by - (ty + 12)) < 22);
      if (!hitTag && !hitBadge) break;
      ty = ty + 28 > padT + plotH - 26 ? ty - 28 * (guard + 1) : ty + 28;
    }
    placed.push({ x, y: ty, w });
    return { key: pi, x, y: ty, text, color: patColor(p.bias) };
  }).filter(Boolean) as { key: number; x: number; y: number; text: string; color: string }[];
  const bo = a?.breakout.type && a.breakout.level && inY(a.breakout.level) ? a.breakout : null;

  // Signal strip.
  const chips: { t: string; c: string }[] = [];
  if (a) {
    chips.push({ t: `${a.outlook} ${a.score > 0 ? "+" : ""}${a.score}`, c: a.score >= 15 ? C.up : a.score <= -15 ? C.down : C.fg2 });
    chips.push({ t: `Trend ${a.trend.direction}`, c: a.trend.direction === "up" ? C.up : a.trend.direction === "down" ? C.down : C.fg2 });
    chips.push({ t: `RSI ${a.momentum.rsi.toFixed(0)}`, c: a.momentum.rsi >= 70 ? C.down : a.momentum.rsi <= 30 ? C.up : C.fg2 });
    if (a.momentum.macdCross) chips.push({ t: `MACD ${a.momentum.macdCross} cross`, c: a.momentum.macdCross === "bullish" ? C.up : C.down });
    chips.push({ t: `Volume ${a.volume.ratio.toFixed(1)}x`, c: a.volume.ratio >= 1.5 ? C.amber : C.fg2 });
    if (a.breakout.type) chips.push({ t: `${a.breakout.type === "breakout" ? "Breakout" : "Breakdown"} ${a.breakout.level ? money(a.breakout.level) : ""}`, c: a.breakout.type === "breakout" ? C.up : C.down });
    if (s) chips.push({ t: `${s.side} ${s.kind} · score ${s.confidence}/100 · ${s.riskRewardTp2}R`, c: s.kind === "confirmed" ? C.up : C.amber });
  }
  const patChips = pats.map((p) => ({ t: `${p.bias === "bullish" ? "▲" : "▼"} ${p.name} (${p.status})`, c: patColor(p.bias) }));

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, color: C.fg, fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 24px 0 24px", fontSize: 26 }}>
          <span style={{ fontWeight: 800 }}>{symbol}</span>
          <span style={{ color: C.fg2 }}>{tf}</span>
          <span style={{ color: side === "LONG" ? C.up : C.down, fontWeight: 700 }}>{side}</span>
          {last != null ? <span style={{ color: C.fg2 }}>{money(last)}</span> : null}
          <span style={{ display: "flex", gap: 12, marginLeft: 16, fontSize: 15, color: C.fg2 }}>
            {e20.length ? <span style={{ color: C.ema20 }}>EMA 20</span> : null}
            {e50.length ? <span style={{ color: C.ema50 }}>EMA 50</span> : null}
          </span>
          <span style={{ marginLeft: "auto", color: C.fg2, fontSize: 18 }}>AsheSignal · manual trading only</span>
        </div>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          {gridLines.map((g, i) => <line key={i} x1={padL} x2={plotR} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth={1} />)}
          {eL != null && eH != null && inY(eL) ? <rect x={padL} y={y(Math.min(eH, hi))} width={plotW} height={Math.max(2, y(eL) - y(Math.min(eH, hi)))} fill={side === "LONG" ? C.zone : C.zoneS} /> : null}
          {candles.map((c, i) => {
            const x = padL + i * cw + cw * 0.15; const w = Math.max(2, cw * 0.7); const col = c.close >= c.open ? C.up : C.down;
            return (<g key={i}><line x1={x + w / 2} x2={x + w / 2} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1.5} /><rect x={x} y={y(Math.max(c.open, c.close))} width={w} height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))} fill={col} /></g>);
          })}
          {e20.length ? <path d={e20.map((v, i) => `${i ? "L" : "M"}${(padL + i * cw + cw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={C.ema20} strokeWidth={1.8} /> : null}
          {e50.length ? <path d={e50.map((v, i) => `${i ? "L" : "M"}${(padL + i * cw + cw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={C.ema50} strokeWidth={1.8} /> : null}
          {patLines.map((l) => <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} />)}
          {patPoints.map((p) => <circle key={p.key} cx={p.x} cy={p.y} r={5} fill={C.bg} stroke={p.color} strokeWidth={2.5} />)}
          {bo ? <line x1={padL} x2={plotR} y1={y(bo.level!)} y2={y(bo.level!)} stroke={bo.type === "breakout" ? C.up : C.down} strokeWidth={1.5} strokeDasharray="2 4" /> : null}
          {levels.filter((l) => l.k !== "entryLow" && l.k !== "entryHigh" && inY(l.v)).map((l) => <line key={l.k} x1={padL} x2={plotR} y1={y(l.v)} y2={y(l.v)} stroke={lineColor(l.k)} strokeWidth={2} strokeDasharray={l.k.startsWith("sl") ? "10 6" : "4 4"} />)}
          <rect x={0} y={H - stripH} width={W} height={stripH} fill={C.panel} />
        </svg>
        {gridLines.map((g, i) => <div key={`g${i}`} style={{ position: "absolute", left: plotR + 8, top: y(g) - 10, fontSize: 15, color: C.fg2, display: "flex" }}>{money(g)}</div>)}
        {levels.filter((l) => l.k !== "entryLow" && l.k !== "entryHigh" && inY(l.v)).map((l) => (
          <div key={`l${l.k}`} style={{ position: "absolute", left: plotR - 150, top: y(l.v) - 13, width: 146, height: 26, borderRadius: 6, background: lineColor(l.k), color: C.bg, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{`${l.k.toUpperCase()} ${money(l.v)}`}</div>
        ))}
        {eL != null && eH != null && inY(eH) ? <div style={{ position: "absolute", left: padL + 8, top: y(eH) - 24, fontSize: 15, fontWeight: 700, color: C.amber, display: "flex" }}>{`ENTRY ${money(eL)} to ${money(eH)}`}</div> : null}
        {bo ? <div style={{ position: "absolute", left: padL + 260, top: y(bo.level!) - 22, fontSize: 14, fontWeight: 700, color: bo.type === "breakout" ? C.up : C.down, display: "flex" }}>{`${bo.type === "breakout" ? "BREAKOUT" : "BREAKDOWN"} ${money(bo.level!)}`}</div> : null}
        {patPoints.map((p) => <div key={`pl${p.key}`} style={{ position: "absolute", left: p.x - 30, top: p.side === "above" ? p.y - 26 : p.y + 8, width: 60, fontSize: 13, fontWeight: 700, color: p.color, display: "flex", justifyContent: "center" }}>{p.label}</div>)}
        {patTags.map((t) => <div key={`pt${t.key}`} style={{ position: "absolute", left: t.x, top: t.y, fontSize: 14, fontWeight: 700, color: t.color, background: C.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${t.color}`, display: "flex" }}>{t.text}</div>)}
        {!candles.length ? <div style={{ position: "absolute", left: 0, top: padT + plotH / 2 - 16, width: W, fontSize: 24, color: C.fg2, display: "flex", justifyContent: "center" }}>Candles unavailable right now</div> : null}
        {/* signal strip */}
        <div style={{ position: "absolute", left: 0, top: H - stripH, width: W, height: stripH, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, padding: "0 20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {chips.length ? chips.map((c, i) => <div key={i} style={{ display: "flex", fontSize: 16, fontWeight: 700, color: c.c, border: `1px solid ${c.c}`, borderRadius: 999, padding: "3px 10px" }}>{c.t}</div>) : <div style={{ display: "flex", fontSize: 16, color: C.fg2 }}>Signals unavailable (not enough candles)</div>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {patChips.length ? patChips.map((c, i) => <div key={i} style={{ display: "flex", fontSize: 15, fontWeight: 600, color: c.c }}>{c.t}</div>) : <div style={{ display: "flex", fontSize: 15, color: C.fg2 }}>No chart pattern detected on this timeframe</div>}
          </div>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}
