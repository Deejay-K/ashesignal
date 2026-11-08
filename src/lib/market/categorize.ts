// Category logic for the trading discovery hub. Pure functions over engine output.

import type { TimeframeAnalysis } from "@/lib/ta/analysis";
import { fmtUsd } from "@/lib/format";

export type Category = "confirmed" | "watching" | "none";

export interface WatchItem { what: string; why: string; needs: string }

/** The engine's own recent record on this chart (walk-forward backtest of its signals). */
export interface EngineRecord { n: number; winRate: number | null; expectancyR: number | null }

export interface CategorizeContext {
  /** Next-higher timeframe analysis (1h -> 4h, 4h -> 1d). A confirmed setup against it is demoted to watching. */
  htf?: TimeframeAnalysis | null;
  /** Backtest record of the engine on this coin/timeframe; weak records demote to watching. */
  record?: EngineRecord | null;
  /** Market regime verdict for this symbol/side (from regimeAllows). */
  regime?: { ok: boolean; reason: string | null } | null;
}

export const RECORD_MIN_TRADES = 8;
export const RECORD_MIN_WINRATE = 50;

/** Decide the category for one timeframe analysis and explain it. */
export function categorize(a: TimeframeAnalysis, ctx: CategorizeContext = {}): { category: Category; reasons: string[]; watch: WatchItem[]; qualifies: string[] } {
  const s = a.setup;
  const qualifies: string[] = [];
  const watch: WatchItem[] = [];
  // Gates that live outside a single timeframe: higher-timeframe agreement and the engine's record here.
  const htfGap = (() => {
    if (!s || s.kind !== "confirmed" || !ctx.htf) return null;
    const h = ctx.htf;
    const against = s.side === "LONG" ? (h.trend.direction === "down" || h.score <= -15) : (h.trend.direction === "up" || h.score >= 15);
    return against ? `${h.timeframe} disagrees: trend ${h.trend.direction}, score ${h.score > 0 ? "+" : ""}${h.score}. Trading against the higher timeframe is where most stops get hit.` : null;
  })();
  const recGap = (() => {
    const r = ctx.record;
    if (!s || s.kind !== "confirmed" || !r || r.n < RECORD_MIN_TRADES) return null;
    if ((r.winRate ?? 0) < RECORD_MIN_WINRATE || (r.expectancyR ?? 0) <= 0) return `The engine's recent record on this chart is weak: ${r.winRate ?? 0}% winners over ${r.n} signals, ${r.expectancyR ?? 0}R per trade. Not confirmed until the record improves.`;
    return null;
  })();
  const regGap = s && s.kind === "confirmed" && ctx.regime && !ctx.regime.ok ? ctx.regime.reason : null;
  if (s && s.kind === "confirmed" && !htfGap && !recGap && !regGap) {
    qualifies.push(`Score ${a.score > 0 ? "+" : ""}${a.score} (${a.outlook}) is beyond the ±35 confirmation band.`);
    if (a.breakout.type) qualifies.push(`Level ${a.breakout.type}: ${a.breakout.note}`);
    for (const p of a.patterns.confirmed.slice(0, 2)) qualifies.push(`Confirmed ${p.bias} pattern: ${p.name} (${Math.round(p.confidence * 100)}%).`);
    if (a.trend.direction !== "sideways") qualifies.push(`Trend confirmation: ${a.trend.direction} on the EMA stack${a.trend.sma200 != null ? `, price ${a.price > a.trend.sma200 ? "above" : "below"} the 200 SMA` : ""}.`);
    if (a.volume.ratio >= 1) qualifies.push(`Volume ${a.volume.ratio.toFixed(2)}x average (${a.volume.trend}).`);
    qualifies.push(`TP1 ${s.takeProfits[0].rr}R, TP2 ${s.riskRewardTp2}R against a level-based stop; confidence ${s.confidence}%.`);
    if (ctx.htf) qualifies.push(`Higher timeframe (${ctx.htf.timeframe}) agrees: trend ${ctx.htf.trend.direction}, score ${ctx.htf.score > 0 ? "+" : ""}${ctx.htf.score}.`);
    if (ctx.record && ctx.record.n >= RECORD_MIN_TRADES) qualifies.push(`Engine record on this chart: ${ctx.record.winRate}% winners over ${ctx.record.n} recent signals, ${ctx.record.expectancyR}R per trade.`);
    else if (ctx.record) qualifies.push(`Engine record on this chart: only ${ctx.record.n} recent signals (not enough to grade).`);
    return { category: "confirmed", reasons: qualifies, watch: [], qualifies };
  }
  if (regGap) watch.push({ what: "Setup qualifies, market regime does not", why: regGap, needs: "A regime change (BTC trend or breadth) or a BTC setup instead of an altcoin." });
  if (htfGap) watch.push({ what: `Confirmed on ${a.timeframe} but against the higher timeframe`, why: htfGap, needs: `${ctx.htf!.timeframe} turning ${s!.side === "LONG" ? "up" : "down"} (or at least neutral) while this setup holds.` });
  if (recGap) watch.push({ what: "Setup qualifies, engine record here does not", why: recGap, needs: `At least ${RECORD_MIN_WINRATE}% winners and positive expectancy over the last ${RECORD_MIN_TRADES}+ signals on this chart.` });
  if (s && s.kind === "speculative" && s.quality.confirmGaps.length) {
    for (const g of s.quality.confirmGaps.slice(0, 3)) watch.push({ what: `${s.side} bias, one gate short of confirmed`, why: g, needs: "That gate passing on a candle close moves this to Confirmed." });
  }
  // watching signals
  const near = (lvl: number) => Math.abs(lvl - a.price) / a.price <= a.volatility.atrPct * 1.2;
  const res = a.levels.filter((l) => l.kind === "resistance").sort((x, y) => x.price - y.price)[0];
  const sup = a.levels.filter((l) => l.kind === "support").sort((x, y) => y.price - x.price)[0];
  if (res && near(res.price)) watch.push({ what: `Approaching resistance ${fmtUsd(res.price)} (${res.touches} touches)`, why: "A tested ceiling is within about one ATR; the reaction here decides the next leg.", needs: `A candle close above ${fmtUsd(res.price)} on above-average volume (breakout), or a rejection wick to short.` });
  if (sup && near(sup.price)) watch.push({ what: `Approaching support ${fmtUsd(sup.price)} (${sup.touches} touches)`, why: "A tested floor is within about one ATR; buyers defended it before.", needs: `A bullish reversal candle at the level to long, or a close below ${fmtUsd(sup.price)} for a breakdown.` });
  for (const p of a.patterns.forming.slice(0, 2)) watch.push({ what: `${p.name} forming (${p.bias})`, why: p.description.split(".")[0] + ".", needs: p.keyLevel != null ? `A close ${p.bias === "bullish" ? "above" : "below"} ${fmtUsd(p.keyLevel)} confirms it${p.target != null ? `; measured target ${fmtUsd(p.target)}` : ""}.` : "Trigger level not yet defined." });
  if (a.momentum.rsi >= 62 && a.momentum.rsi < 70) watch.push({ what: `RSI ${a.momentum.rsi.toFixed(0)} approaching overbought`, why: "Momentum is strong but close to the 70 line where pullbacks start.", needs: "A push through 70 with volume keeps the trend; a turn down from here with a bearish divergence favours a short." });
  if (a.momentum.rsi <= 38 && a.momentum.rsi > 30) watch.push({ what: `RSI ${a.momentum.rsi.toFixed(0)} approaching oversold`, why: "Selling is nearly exhausted on this timeframe.", needs: "A dip under 30 followed by a bullish divergence or engulfing candle sets up a bounce long." });
  if (!a.momentum.macdCross && Math.abs(a.momentum.macdHist) / a.price < 0.0015) watch.push({ what: "MACD close to crossing", why: "The histogram is near zero; a cross is one or two candles away.", needs: `A ${a.momentum.macdHist >= 0 ? "bearish" : "bullish"} cross would flip momentum; trade in the direction of the cross with the trend.` });
  if (a.volume.trend === "rising" && a.volume.ratio >= 1.2) watch.push({ what: `Volume building (${a.volume.ratio.toFixed(1)}x average, rising)`, why: "Participation is returning before a directional move.", needs: "A break of the nearest level with this volume behind it." });
  if (a.volatility.regime === "squeeze") watch.push({ what: "Volatility squeeze", why: "Bollinger width is in its bottom 15%: compression precedes expansion.", needs: "The first close outside the bands sets the direction; do not guess early." });
  for (const r of a.reversalSigns.slice(0, 2)) watch.push({ what: "Possible reversal sign", why: r, needs: "Confirmation by a level break in the new direction." });

  if (watch.length) return { category: "watching", reasons: watch.map((w) => w.what), watch, qualifies: [] };
  return { category: "none", reasons: [], watch: [], qualifies: [] };
}

/** Compact snapshot stored in coin_metrics.detail for the discovery cards. */
export function detailSnapshot(a: TimeframeAnalysis, cat: ReturnType<typeof categorize>, ctx: CategorizeContext = {}) {
  const s = a.setup;
  return {
    htf: ctx.htf ? { timeframe: ctx.htf.timeframe, trend: ctx.htf.trend.direction, score: ctx.htf.score } : null,
    record: ctx.record ?? null,
    regimeGap: ctx.regime && !ctx.regime.ok ? ctx.regime.reason : null,
    price: a.price,
    outlook: a.outlook,
    score: a.score,
    trend: a.trend,
    momentum: { rsi: +a.momentum.rsi.toFixed(1), macdCross: a.momentum.macdCross, macdHist: a.momentum.macdHist },
    volume: { ratio: +a.volume.ratio.toFixed(2), trend: a.volume.trend, note: a.volume.note },
    volatility: { atrPct: +(a.volatility.atrPct * 100).toFixed(2), regime: a.volatility.regime },
    levels: a.levels.map((l) => ({ price: l.price, kind: l.kind, touches: l.touches })),
    breakout: a.breakout,
    indicators: a.reasons.filter((r) => r.weight !== 0).sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)).slice(0, 6).map((r) => `${r.weight > 0 ? "+" : ""}${r.weight.toFixed(0)} ${r.text}`),
    patterns: { confirmed: a.patterns.confirmed.map((p) => ({ name: p.name, bias: p.bias, confidence: p.confidence, keyLevel: p.keyLevel, target: p.target })), forming: a.patterns.forming.map((p) => ({ name: p.name, bias: p.bias, confidence: p.confidence, keyLevel: p.keyLevel, target: p.target })) },
    scenarios: a.scenarios,
    setup: s ? { side: s.side, kind: s.kind, entry: s.entry, takeProfits: s.takeProfits.map((t) => ({ label: t.label, price: t.price, rr: t.rr, basis: t.basis, reliable: t.reliable })), stopLosses: s.stopLosses.map((t) => ({ label: t.label, price: t.price, basis: t.basis, reliable: t.reliable })), rr: s.riskRewardTp2, confidence: s.confidence, leverage: s.leverage, style: s.style, holdingPeriod: s.holdingPeriod, invalidation: s.invalidation, reasons: s.reasons, issues: s.quality.issues, confirmGaps: s.quality.confirmGaps } : null,
    qualifies: cat.qualifies,
    watch: cat.watch,
  };
}
