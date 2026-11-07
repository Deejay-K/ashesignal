// Per-timeframe analysis: turns raw candles into a scored, explained outlook
// plus a concrete LONG/SHORT setup (entry / TP1-3 / SL1-2 / R:R / invalidation).
//
// Every number in a setup is derived from the chart (ATR, swing levels, S/R),
// never invented. Targets are ALWAYS computed from the chart structure; when the engine
// does not rate the situation a trade yet, `setup.kind` is "watch" and `setup.quality.issues`
// lists why. `setup` is only null when there are not enough candles.

import type { Candle, Timeframe } from "@/lib/types";
import { atr, bollinger, ema, fibonacci, last, macd, normalizedSlope, rsi, sma, volumeProfile, vwap } from "./indicators";
import { findPivots, supportResistance, trendlines, type Level, type Trendline } from "./levels";
import { detectPatterns, fmt, type Pattern } from "./patterns";

export type Outlook = "strongly bullish" | "bullish" | "neutral" | "bearish" | "strongly bearish";
export type TradeStyle = "scalp" | "day trade" | "swing" | "position";

export interface Reason {
  text: string;
  weight: number; // signed contribution to score
  group: "trend" | "momentum" | "volume" | "volatility" | "structure" | "pattern";
}

export interface LeverageAdvice {
  recommended: number; // x
  conservative: number;
  aggressive: number;
  maxSafe: number; // liquidation stays >= 2.5x SL1 distance and >= 1.5x SL2 distance
  liquidationPctAtRecommended: number; // % adverse move that liquidates at the recommended leverage
  stopDistancePct: number; // entry -> SL1
  rationale: string[];
}

/**
 * Leverage from risk geometry. Liquidation distance for isolated-margin perps is roughly 100%/leverage
 * (ignoring maintenance margin, so we keep a 2.5x cushion over SL1 and 1.5x over SL2). Setup quality and
 * volatility then cap the number. 1x means spot or no leverage.
 */
export function adviseLeverage(i: { entry: number; sl1: number; sl2: number; kind: "confirmed" | "speculative" | "watch"; atrPct: number; regime: string; tf: Timeframe; confidence: number }): LeverageAdvice {
  const d1 = Math.abs(i.entry - i.sl1) / i.entry * 100;
  const d2 = Math.abs(i.entry - i.sl2) / i.entry * 100;
  const rationale: string[] = [];
  const maxSafe = Math.max(1, Math.floor(Math.min(100 / (2.5 * Math.max(d1, 0.05)), 100 / (1.5 * Math.max(d2, 0.05)), 50)));
  rationale.push(`SL1 is ${d1.toFixed(2)}% from entry and SL2 ${d2.toFixed(2)}%; keeping liquidation at least 2.5x past SL1 and 1.5x past SL2 allows at most ${maxSafe}x.`);
  let cap = i.kind === "confirmed" ? 10 : i.kind === "speculative" ? 5 : 1;
  rationale.push(i.kind === "confirmed" ? "Confirmed setup: quality cap 10x." : i.kind === "speculative" ? "Speculative setup: quality cap 5x." : "Watch only: no leverage until the setup qualifies (1x / spot).");
  if (i.regime === "expanded") { cap = Math.max(1, Math.floor(cap / 2)); rationale.push("Volatility is expanded: cap halved."); }
  if (i.atrPct > 0.08) { cap = Math.min(cap, 2); rationale.push(`ATR is ${(i.atrPct * 100).toFixed(1)}% per candle: cap 2x.`); }
  else if (i.atrPct > 0.04) { cap = Math.min(cap, 3); rationale.push(`ATR is ${(i.atrPct * 100).toFixed(1)}% per candle: cap 3x.`); }
  if (i.tf === "1m" || i.tf === "5m") { cap = Math.min(cap, 5); rationale.push("Scalp timeframe: cap 5x (stops are tight; slippage matters more than leverage)."); }
  if (i.confidence < 45) { cap = Math.min(cap, 2); rationale.push(`Confidence ${i.confidence}%: cap 2x.`); }
  const recommended = Math.max(1, Math.min(maxSafe, cap));
  const conservative = Math.max(1, Math.floor(recommended / 2));
  const aggressive = Math.max(recommended, Math.min(maxSafe, recommended * 2));
  return { recommended, conservative, aggressive, maxSafe, liquidationPctAtRecommended: round2(100 / recommended), stopDistancePct: round2(d1), rationale };
}

export interface Setup {
  side: "LONG" | "SHORT";
  /**
   * confirmed   strong score + a confirmed pattern or level break
   * speculative directional bias without a confirmed trigger
   * watch       targets are computed from structure but the engine does NOT rate this a trade yet
   *             (neutral score, poor reward:risk, or extreme volatility); `quality` says why
   */
  kind: "confirmed" | "speculative" | "watch";
  quality: { tradeable: boolean; issues: string[] };
  entry: { low: number; high: number; mid: number; type: "pullback" | "breakout" | "market" };
  takeProfits: { label: string; price: number; basis: string; rr: number; reliable: boolean }[];
  stopLosses: { label: string; price: number; basis: string; pctFromEntry: number; reliable: boolean }[];
  riskRewardTp2: number;
  leverage: LeverageAdvice;
  confidence: number; // 0-100
  style: TradeStyle;
  holdingPeriod: string;
  holdingReason: string;
  invalidation: string[];
  reasons: string[];
  exitEarlyIf: string[];
  takeProfitWhen: string[];
}

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  candles: number;
  price: number;
  outlook: Outlook;
  score: number; // -100 .. +100
  opportunityScore: number; // 0..100
  trend: { direction: "up" | "down" | "sideways"; strength: number; ema20: number; ema50: number; sma200: number | null };
  momentum: { rsi: number; macdHist: number; macdCross: "bullish" | "bearish" | null; roc: number };
  volume: { last: number; avg20: number; ratio: number; trend: "rising" | "falling" | "flat"; note: string };
  volatility: { atr: number; atrPct: number; bbWidth: number; regime: "squeeze" | "normal" | "expanded"; note: string };
  levels: Level[];
  trendlines: Trendline[];
  fib: { ratio: number; price: number }[];
  volumePoc: number | null;
  vwap: number | null;
  patterns: { all: Pattern[]; confirmed: Pattern[]; completed: Pattern[]; forming: Pattern[]; failed: Pattern[]; invalidated: Pattern[] };
  breakout: { type: "breakout" | "breakdown" | null; level: number | null; note: string };
  reasons: Reason[];
  scenarios: { bullish: string; bearish: string };
  setup: Setup | null;
  setupReason: string;
  weakeningMomentum: string[];
  reversalSigns: string[];
}

/** Candle counts per timeframe considered "enough" for robust analysis. */
const MIN_CANDLES = 60;

export function analyzeTimeframe(tf: Timeframe, candles: Candle[]): TimeframeAnalysis | null {
  if (candles.length < MIN_CANDLES) return null;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const price = last(closes);

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const s200 = candles.length >= 200 ? sma(closes, 200) : null;
  const r = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const a = atr(candles, 14);
  const vw = vwap(candles, 50);
  const v20 = sma(vols, 20);

  const reasons: Reason[] = [];
  const add = (group: Reason["group"], text: string, weight: number) => reasons.push({ group, text, weight });

  /* ---- trend ---- */
  const ema20 = last(e20);
  const ema50 = last(e50);
  const sma200 = s200 ? last(s200) : null;
  const slope50 = normalizedSlope(e50, 10);
  let dir: "up" | "down" | "sideways" = "sideways";
  if (price > ema20 && ema20 > ema50 && slope50 > 0.0005) dir = "up";
  else if (price < ema20 && ema20 < ema50 && slope50 < -0.0005) dir = "down";
  const strength = Math.min(1, Math.abs(ema20 - ema50) / ema50 / 0.05 + Math.abs(slope50) * 100);
  if (dir === "up") add("trend", `Price above the 20 EMA (${fmt(ema20)}) which is above the 50 EMA (${fmt(ema50)}), and the 50 EMA is rising - bullish alignment.`, 20 + 15 * strength);
  else if (dir === "down") add("trend", `Price below the 20 EMA (${fmt(ema20)}) which is below the 50 EMA (${fmt(ema50)}), and the 50 EMA is falling - bearish alignment.`, -(20 + 15 * strength));
  else add("trend", `EMAs are intertwined (20: ${fmt(ema20)}, 50: ${fmt(ema50)}) - no clear trend on this timeframe.`, 0);
  if (sma200 != null) {
    if (price > sma200) add("trend", `Price is above the 200 SMA (${fmt(sma200)}) - long-term bias is up.`, 10);
    else add("trend", `Price is below the 200 SMA (${fmt(sma200)}) - long-term bias is down.`, -10);
  }

  /* ---- momentum ---- */
  const rsiNow = last(r);
  const rsiPrev = r[r.length - 2];
  const hist = last(m.hist);
  const histPrev = m.hist[m.hist.length - 2];
  const lineNow = last(m.line);
  const sigNow = last(m.signal);
  const linePrev = m.line[m.line.length - 2];
  const sigPrev = m.signal[m.signal.length - 2];
  let macdCross: "bullish" | "bearish" | null = null;
  // look back 3 bars for a cross
  for (let i = closes.length - 1; i >= closes.length - 3; i--) {
    const l0 = m.line[i], s0 = m.signal[i], l1 = m.line[i - 1], s1 = m.signal[i - 1];
    if (l1 <= s1 && l0 > s0) { macdCross = "bullish"; break; }
    if (l1 >= s1 && l0 < s0) { macdCross = "bearish"; break; }
  }
  void linePrev; void sigPrev;
  const roc = (price - closes[closes.length - 11]) / closes[closes.length - 11];
  if (rsiNow >= 70) add("momentum", `RSI ${rsiNow.toFixed(0)} is overbought - strong momentum but stretched; pullback risk rises.`, dir === "up" ? -4 : -10);
  else if (rsiNow <= 30) add("momentum", `RSI ${rsiNow.toFixed(0)} is oversold - selling is stretched; bounce risk rises.`, dir === "down" ? 4 : 10);
  else if (rsiNow > 55) add("momentum", `RSI ${rsiNow.toFixed(0)} sits in bullish territory.`, 8);
  else if (rsiNow < 45) add("momentum", `RSI ${rsiNow.toFixed(0)} sits in bearish territory.`, -8);
  else add("momentum", `RSI ${rsiNow.toFixed(0)} is neutral.`, 0);
  if (macdCross === "bullish") add("momentum", "MACD line crossed above its signal within the last 3 candles.", 12);
  else if (macdCross === "bearish") add("momentum", "MACD line crossed below its signal within the last 3 candles.", -12);
  else if (hist > 0 && hist > histPrev) add("momentum", "MACD histogram is positive and expanding - momentum building.", 8);
  else if (hist > 0 && hist < histPrev) add("momentum", "MACD histogram is positive but shrinking - bullish momentum fading.", 2);
  else if (hist < 0 && hist < histPrev) add("momentum", "MACD histogram is negative and expanding - downside momentum building.", -8);
  else if (hist < 0 && hist > histPrev) add("momentum", "MACD histogram is negative but shrinking - selling pressure easing.", -2);
  void lineNow; void sigNow;

  /* ---- volume ---- */
  const volLast = last(vols);
  const volAvg = last(v20) || 1;
  const volRatio = volLast / volAvg;
  const volSlope = normalizedSlope(v20, 10);
  const volTrend: "rising" | "falling" | "flat" = volSlope > 0.01 ? "rising" : volSlope < -0.01 ? "falling" : "flat";
  const lastCandleUp = candles[candles.length - 1].close >= candles[candles.length - 1].open;
  let volNote = `Last candle volume is ${volRatio.toFixed(1)}× the 20-period average.`;
  if (volRatio >= 2) {
    volNote = `Unusual volume: ${volRatio.toFixed(1)}× average on a ${lastCandleUp ? "green" : "red"} candle.`;
    add("volume", volNote, lastCandleUp ? 10 : -10);
  } else if (volTrend === "rising" && dir === "up") add("volume", "Volume is rising with the uptrend - participation confirms the move.", 6);
  else if (volTrend === "rising" && dir === "down") add("volume", "Volume is rising with the downtrend - distribution confirms the move.", -6);
  else if (volTrend === "falling" && dir !== "sideways") add("volume", `Volume is fading while the trend is ${dir} - move is losing participation.`, dir === "up" ? -4 : 4);

  /* ---- volatility ---- */
  const atrNow = last(a);
  const atrPct = atrNow / price;
  const bbw = last(bb.width);
  const bbwHist = bb.width.slice(-100).filter(Number.isFinite);
  const bbwRank = bbwHist.length ? bbwHist.filter((x) => x < bbw).length / bbwHist.length : 0.5;
  const regime: "squeeze" | "normal" | "expanded" = bbwRank < 0.15 ? "squeeze" : bbwRank > 0.85 ? "expanded" : "normal";
  let volaNote = `ATR ${fmt(atrNow)} (${(atrPct * 100).toFixed(2)}% of price).`;
  if (regime === "squeeze") { volaNote += " Bollinger squeeze - volatility is compressed; an expansion move often follows."; add("volatility", "Bollinger Band squeeze: volatility compressed to the bottom 15% of its recent range - breakout watch.", 0); }
  if (regime === "expanded") { volaNote += " Bands are at their widest - moves are extended."; }

  /* ---- levels, trendlines, fib, vp ---- */
  const pivots = findPivots(candles, 3, 3);
  const levels = supportResistance(candles, pivots, atrPct * 0.8 + 0.002, 5);
  const tls = trendlines(candles, pivots);
  const recent = candles.slice(-120);
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const swingLow = Math.min(...recent.map((c) => c.low));
  const fib = fibonacci(swingHigh, swingLow, dir === "down" ? "down" : "up");
  const vp = volumeProfile(recent, 24);
  const poc = vp.poc ? (vp.poc.priceLow + vp.poc.priceHigh) / 2 : null;
  const vwapNow = Number.isFinite(last(vw)) ? last(vw) : null;
  if (vwapNow != null) {
    if (price > vwapNow) add("trend", `Price is above rolling VWAP (${fmt(vwapNow)}) - buyers are in control on average.`, 4);
    else add("trend", `Price is below rolling VWAP (${fmt(vwapNow)}) - sellers are in control on average.`, -4);
  }

  /* ---- structure / breakout ---- */
  const nearestRes = levels.filter((l) => l.kind === "resistance").sort((x, y) => x.price - y.price)[0];
  const nearestSup = levels.filter((l) => l.kind === "support").sort((x, y) => y.price - x.price)[0];
  let breakout: TimeframeAnalysis["breakout"] = { type: null, level: null, note: "No breakout or breakdown of a tested level in the last 3 candles." };
  const prevRes = levels.filter((l) => l.kind === "support" && l.touches >= 2 && closes[closes.length - 4] < l.price); // was resistance 3 bars ago, now support
  const prevSup = levels.filter((l) => l.kind === "resistance" && l.touches >= 2 && closes[closes.length - 4] > l.price);
  if (prevRes.length) {
    const lv = prevRes.sort((x, y) => y.price - x.price)[0];
    breakout = { type: "breakout", level: lv.price, note: `Broke above a ${lv.touches}-touch level at ${fmt(lv.price)} within the last 3 candles${volRatio >= 1.5 ? " on elevated volume" : " on average volume (weaker)"}.` };
    add("structure", breakout.note, volRatio >= 1.5 ? 14 : 7);
  } else if (prevSup.length) {
    const lv = prevSup.sort((x, y) => x.price - y.price)[0];
    breakout = { type: "breakdown", level: lv.price, note: `Broke below a ${lv.touches}-touch level at ${fmt(lv.price)} within the last 3 candles${volRatio >= 1.5 ? " on elevated volume" : " on average volume (weaker)"}.` };
    add("structure", breakout.note, volRatio >= 1.5 ? -14 : -7);
  }
  if (nearestRes && (nearestRes.price - price) / price < atrPct * 0.7) add("structure", `Price is pressing into resistance at ${fmt(nearestRes.price)} (${nearestRes.touches} touches).`, -3);
  if (nearestSup && (price - nearestSup.price) / price < atrPct * 0.7) add("structure", `Price is sitting on support at ${fmt(nearestSup.price)} (${nearestSup.touches} touches).`, 3);

  /* ---- patterns ---- */
  const pats = detectPatterns(candles);
  const confirmedP = pats.filter((p) => p.status === "confirmed");
  const completed = pats.filter((p) => p.status === "completed");
  const forming = pats.filter((p) => p.status === "forming");
  const failed = pats.filter((p) => p.status === "failed");
  const invalidated = pats.filter((p) => p.status === "invalidated");
  for (const p of confirmedP.slice(0, 3)) add("pattern", `${p.name} (confirmed, ${p.family}): ${p.description}`, (p.bias === "bullish" ? 1 : -1) * 14 * p.confidence);
  for (const p of completed.slice(0, 2)) add("pattern", `${p.name} (completed, target reached): ${p.description}`, (p.bias === "bullish" ? 1 : -1) * 6 * p.confidence);
  for (const p of forming.slice(0, 2)) add("pattern", `${p.name} (forming, unconfirmed): ${p.description}`, (p.bias === "bullish" ? 1 : -1) * 5 * p.confidence);
  for (const p of failed.slice(0, 1)) add("pattern", `${p.name} failed its breakout - a failed ${p.bias} pattern often resolves the other way.`, (p.bias === "bullish" ? -1 : 1) * 6 * p.confidence);

  /* ---- score ---- */
  const score = clamp(Math.round(reasons.reduce((s, x) => s + x.weight, 0)), -100, 100);
  const outlook: Outlook = score >= 45 ? "strongly bullish" : score >= 15 ? "bullish" : score <= -45 ? "strongly bearish" : score <= -15 ? "bearish" : "neutral";

  /* ---- weakening / reversal signs ---- */
  const weakening: string[] = [];
  const reversal: string[] = [];
  const rsiDiverBear = rsiNow < rsiPrev && price > closes[closes.length - 2] && rsiNow > 60;
  const rsiDiverBull = rsiNow > rsiPrev && price < closes[closes.length - 2] && rsiNow < 40;
  if (dir === "up" && hist < histPrev && hist > 0) weakening.push("MACD histogram contracting while price makes new highs.");
  if (dir === "up" && volTrend === "falling") weakening.push("Volume declining as the uptrend extends.");
  if (rsiDiverBear) weakening.push("RSI failing to follow price higher (possible bearish divergence).");
  if (dir === "down" && hist > histPrev && hist < 0) weakening.push("Downside MACD momentum contracting.");
  if (rsiDiverBull) reversal.push("RSI rising while price falls (possible bullish divergence).");
  if (rsiNow <= 30 && lastCandleUp && volRatio >= 1.3) reversal.push("Oversold RSI with a high-volume green candle - capitulation bounce candidate.");
  if (rsiNow >= 70 && !lastCandleUp && volRatio >= 1.3) reversal.push("Overbought RSI with a high-volume red candle - blow-off top candidate.");
  for (const p of forming) reversal.push(`${p.name} forming (${p.bias}) - unconfirmed.`);
  for (const p of failed) reversal.push(`Failed ${p.bias} breakout: ${p.name}.`);

  /* ---- scenarios ---- */
  const resTxt = nearestRes ? fmt(nearestRes.price) : fmt(swingHigh);
  const supTxt = nearestSup ? fmt(nearestSup.price) : fmt(swingLow);
  const scenarios = {
    bullish: `A hold above ${supTxt} and a close through ${resTxt}${volRatio < 1 ? " on rising volume" : ""} opens the path toward ${fmt(nextTarget(levels, price, "up") ?? swingHigh)}. ${regime === "squeeze" ? "The volatility squeeze means the move, if it comes, could be fast." : ""}`.trim(),
    bearish: `Losing ${supTxt} would flip the structure; expect a test of ${fmt(nextTarget(levels, price, "down") ?? swingLow)}. ${rsiNow >= 70 ? "Overbought RSI makes a sharp pullback more likely." : ""}`.trim(),
  };

  /* ---- setup ---- */
  const { setup, setupReason } = buildSetup({ tf, price, score, dir, atrNow, atrPct, levels, swingHigh, swingLow, rsiNow, volRatio, breakout, completed: [...confirmedP, ...completed], forming, ema20, ema50, regime });

  const opportunityScore = clamp(Math.round(Math.abs(score) * 0.6 + (setup && setup.kind !== "watch" ? setup.confidence * 0.4 : 0)), 0, 100);

  return {
    timeframe: tf,
    candles: candles.length,
    price,
    outlook,
    score,
    opportunityScore,
    trend: { direction: dir, strength, ema20, ema50, sma200 },
    momentum: { rsi: rsiNow, macdHist: hist, macdCross, roc },
    volume: { last: volLast, avg20: volAvg, ratio: volRatio, trend: volTrend, note: volNote },
    volatility: { atr: atrNow, atrPct, bbWidth: bbw, regime, note: volaNote },
    levels,
    trendlines: tls,
    fib,
    volumePoc: poc,
    vwap: vwapNow,
    patterns: { all: pats, confirmed: confirmedP, completed, forming, failed, invalidated },
    breakout,
    reasons,
    scenarios,
    setup,
    setupReason,
    weakeningMomentum: weakening,
    reversalSigns: reversal,
  };
}

function nextTarget(levels: Level[], price: number, dirn: "up" | "down"): number | null {
  const ls = dirn === "up" ? levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price) : levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price);
  return ls[1]?.price ?? ls[0]?.price ?? null;
}

interface SetupInput {
  tf: Timeframe; price: number; score: number; dir: "up" | "down" | "sideways"; atrNow: number; atrPct: number;
  levels: Level[]; swingHigh: number; swingLow: number; rsiNow: number; volRatio: number;
  breakout: TimeframeAnalysis["breakout"]; completed: Pattern[]; forming: Pattern[]; ema20: number; ema50: number; regime: string;
}

function buildSetup(i: SetupInput): { setup: Setup | null; setupReason: string } {
  const abs = Math.abs(i.score);
  const issues: string[] = [];
  if (abs < 15) issues.push("Score is inside the neutral band (-15 to +15): no directional edge on this timeframe yet.");
  if (i.atrPct > 0.25) issues.push("Volatility is extreme (ATR > 25% of price): stops are very wide; treat as untradeable until it calms.");

  // Side: score sign; when neutral, lean with the trend so targets are still meaningful.
  const side: Setup["side"] = i.score > 0 ? "LONG" : i.score < 0 ? "SHORT" : i.dir === "down" ? "SHORT" : i.dir === "up" ? "LONG" : i.price >= i.ema50 ? "LONG" : "SHORT";
  const sups = i.levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price);
  const ress = i.levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price);
  const reasons: string[] = [];
  const invalid: string[] = [];
  let kind: Setup["kind"] = abs >= 35 && (i.breakout.type || i.completed.length) ? "confirmed" : "speculative";
  reasons.push(kind === "confirmed" ? "Confirmed: strong score backed by a confirmed pattern or level break." : "Speculative: directional bias without a confirmed trigger yet - size smaller.");

  let entry: Setup["entry"];
  let sl1: number;
  let sl2: number;
  let tps: { price: number; basis: string; reliable: boolean }[] = [];
  let sl1Reliable = true;
  let sl2Reliable = true;

  if (side === "LONG") {
    const s1 = sups[0];
    const pullback = s1 && (i.price - s1.price) / i.price < i.atrPct * 2.5;
    if (i.breakout.type === "breakout" && i.breakout.level) {
      entry = { low: i.breakout.level, high: i.breakout.level + i.atrNow * 0.5, mid: i.breakout.level + i.atrNow * 0.25, type: "breakout" };
      reasons.push(`Entry on a retest of the broken level ${fmt(i.breakout.level)}.`);
    } else if (pullback && s1) {
      entry = { low: s1.price, high: s1.price + i.atrNow * 0.6, mid: s1.price + i.atrNow * 0.3, type: "pullback" };
      reasons.push(`Pullback entry into support at ${fmt(s1.price)} (${s1.touches} touches).`);
    } else {
      entry = { low: i.price - i.atrNow * 0.4, high: i.price, mid: i.price - i.atrNow * 0.2, type: "market" };
      reasons.push("No clean pullback level nearby - scale in near market with a tight ATR stop.");
    }
    const below = sups.filter((s) => s.price < entry.low);
    // structural stop under the nearest support if it is within 2.5 ATR, else a 1.5 ATR stop
    const structL = below[0] ? below[0].price - i.atrNow * 0.3 : null;
    sl1Reliable = structL != null && entry.low - structL <= i.atrNow * 2.5;
    sl1 = sl1Reliable ? Math.min(structL!, entry.low - i.atrNow * 0.8) : entry.low - i.atrNow * 1.5;
    const struct2L = below.find((b) => b.price - i.atrNow * 0.3 < sl1 - i.atrNow * 0.5 && entry.low - b.price <= i.atrNow * 4.5);
    sl2Reliable = !!struct2L;
    sl2 = struct2L ? struct2L.price - i.atrNow * 0.3 : sl1 - i.atrNow * 1.0;
    const above = ress.filter((r) => r.price > entry.high + i.atrNow * 1.0);
    tps = [
      { price: above[0]?.price ?? entry.mid + i.atrNow * 2, basis: above[0] ? `nearest resistance (${above[0].touches} touches)` : "2x ATR extension (no structural level)", reliable: !!above[0] },
      { price: above[1]?.price ?? Math.max(i.swingHigh, entry.mid + i.atrNow * 3.5), basis: above[1] ? "second resistance" : "swing high / 3.5x ATR (no structural level)", reliable: !!above[1] },
      { price: Math.max(i.swingHigh, above[2]?.price ?? 0, entry.mid + i.atrNow * 5), basis: above[2] ? "third resistance / swing high" : "swing high or 5x ATR extension (no structural level)", reliable: !!above[2] },
    ];
    if (above[3]) tps.push({ price: above[3].price, basis: `fourth resistance (${above[3].touches} touches)`, reliable: true });
    invalid.push(`A candle close below ${fmt(sl1)} invalidates the setup.`);
    if (i.ema50 < i.price) invalid.push(`Loss of the 50 EMA (${fmt(i.ema50)}) with rising volume.`);
    if (i.rsiNow >= 70) invalid.push("RSI is already overbought; a bearish MACD cross would remove the edge.");
  } else {
    const r1 = ress[0];
    const pullback = r1 && (r1.price - i.price) / i.price < i.atrPct * 2.5;
    if (i.breakout.type === "breakdown" && i.breakout.level) {
      entry = { low: i.breakout.level - i.atrNow * 0.5, high: i.breakout.level, mid: i.breakout.level - i.atrNow * 0.25, type: "breakout" };
      reasons.push(`Entry on a retest of the broken support ${fmt(i.breakout.level)} from below.`);
    } else if (pullback && r1) {
      entry = { low: r1.price - i.atrNow * 0.6, high: r1.price, mid: r1.price - i.atrNow * 0.3, type: "pullback" };
      reasons.push(`Short into resistance at ${fmt(r1.price)} (${r1.touches} touches).`);
    } else {
      entry = { low: i.price, high: i.price + i.atrNow * 0.4, mid: i.price + i.atrNow * 0.2, type: "market" };
      reasons.push("No clean rally level nearby - scale in near market with a tight ATR stop.");
    }
    const above = ress.filter((r) => r.price > entry.high);
    const structS = above[0] ? above[0].price + i.atrNow * 0.3 : null;
    sl1Reliable = structS != null && structS - entry.high <= i.atrNow * 2.5;
    sl1 = sl1Reliable ? Math.max(structS!, entry.high + i.atrNow * 0.8) : entry.high + i.atrNow * 1.5;
    const struct2S = above.find((b) => b.price + i.atrNow * 0.3 > sl1 + i.atrNow * 0.5 && b.price - entry.high <= i.atrNow * 4.5);
    sl2Reliable = !!struct2S;
    sl2 = struct2S ? struct2S.price + i.atrNow * 0.3 : sl1 + i.atrNow * 1.0;
    const below = sups.filter((s) => s.price < entry.low - i.atrNow * 1.0);
    tps = [
      { price: below[0]?.price ?? entry.mid - i.atrNow * 2, basis: below[0] ? `nearest support (${below[0].touches} touches)` : "2x ATR extension (no structural level)", reliable: !!below[0] },
      { price: below[1]?.price ?? Math.min(i.swingLow, entry.mid - i.atrNow * 3.5), basis: below[1] ? "second support" : "swing low / 3.5x ATR (no structural level)", reliable: !!below[1] },
      { price: Math.min(i.swingLow, below[2]?.price ?? Infinity, entry.mid - i.atrNow * 5), basis: below[2] ? "third support / swing low" : "swing low or 5x ATR extension (no structural level)", reliable: !!below[2] },
    ];
    if (below[3]) tps.push({ price: below[3].price, basis: `fourth support (${below[3].touches} touches)`, reliable: true });
    invalid.push(`A candle close above ${fmt(sl1)} invalidates the setup.`);
    if (i.ema50 > i.price) invalid.push(`Reclaim of the 50 EMA (${fmt(i.ema50)}) with rising volume.`);
    if (i.rsiNow <= 30) invalid.push("RSI is already oversold; a bullish MACD cross would remove the edge.");
  }

  let risk = Math.abs(entry.mid - sl1);
  if (risk <= 0) {
    sl1 = side === "LONG" ? entry.mid - i.atrNow * 1.5 : entry.mid + i.atrNow * 1.5;
    sl1Reliable = false;
    risk = i.atrNow * 1.5;
    issues.push("Level structure too tight for a structural stop; SL1 is a 1.5x ATR stop.");
  }
  const takeProfits = tps.map((t, idx) => ({ label: `TP${idx + 1}`, price: t.price, basis: t.basis, rr: round2(Math.abs(t.price - entry.mid) / risk), reliable: t.reliable }));
  // ensure TPs are strictly ordered in trade direction
  const ordered = takeProfits.every((t, idx) => idx === 0 || (side === "LONG" ? t.price > takeProfits[idx - 1].price : t.price < takeProfits[idx - 1].price));
  if (!ordered) {
    for (let k = 1; k < takeProfits.length; k++) {
      const prev = takeProfits[k - 1].price;
      if (side === "LONG" ? takeProfits[k].price <= prev : takeProfits[k].price >= prev) {
        takeProfits[k].price = side === "LONG" ? prev + i.atrNow * 1.5 : prev - i.atrNow * 1.5;
        takeProfits[k].basis += " (adjusted for ordering)";
        takeProfits[k].rr = round2(Math.abs(takeProfits[k].price - entry.mid) / risk);
      }
    }
  }
  const rr2 = takeProfits[1].rr;
  if (takeProfits[0].rr < 0.8) issues.push(`TP1 pays only ${takeProfits[0].rr}R against the structural stop: reward does not justify the risk until price pulls back or the stop can tighten.`);
  if (issues.length) kind = "watch";

  const stopLosses = [
    { label: "SL1", price: sl1, basis: sl1Reliable ? (side === "LONG" ? "below nearest support + 0.3 ATR" : "above nearest resistance + 0.3 ATR") : "1.5x ATR stop (no structural level within 2.5 ATR)", pctFromEntry: round2(((sl1 - entry.mid) / entry.mid) * 100), reliable: sl1Reliable },
    { label: "SL2", price: sl2, basis: sl2Reliable ? "wider structural stop (second level)" : "SL1 plus 1x ATR (no second structural level)", pctFromEntry: round2(((sl2 - entry.mid) / entry.mid) * 100), reliable: sl2Reliable },
  ];

  const style = styleFor(i.tf);
  const { holdingPeriod, holdingReason } = holding(i.tf, i.atrPct, takeProfits[1].rr);

  let confidence = 40 + Math.min(35, abs * 0.5);
  if (kind === "confirmed") confidence += 10;
  if (kind === "watch") confidence -= 20;
  if (i.volRatio >= 1.5) confidence += 5;
  if (rr2 >= 2) confidence += 5;
  if (i.regime === "expanded") confidence -= 8;
  confidence = clamp(Math.round(confidence), 20, 90);
  const leverage = adviseLeverage({ entry: entry.mid, sl1, sl2, kind, atrPct: i.atrPct, regime: i.regime, tf: i.tf, confidence });

  return {
    setup: {
      side, kind, quality: { tradeable: kind !== "watch", issues }, entry, takeProfits, stopLosses, riskRewardTp2: rr2, leverage, confidence, style, holdingPeriod, holdingReason,
      invalidation: invalid,
      reasons,
      exitEarlyIf: side === "LONG"
        ? ["A full-bodied red candle closes below the entry zone on volume ≥1.5× average.", "MACD crosses bearish before TP1 is reached.", "A bearish pattern completes on a higher timeframe."]
        : ["A full-bodied green candle closes above the entry zone on volume ≥1.5× average.", "MACD crosses bullish before TP1 is reached.", "A bullish pattern completes on a higher timeframe."],
      takeProfitWhen: ["Take 30-40% at TP1 and move SL1 to break-even.", "Take another 30-40% at TP2; trail the rest with the 20 EMA.", "Close the remainder at TP3 or on a momentum-divergence signal."],
    },
    setupReason: issues.join(" "),
  };
}

function styleFor(tf: Timeframe): TradeStyle {
  if (tf === "1m" || tf === "5m") return "scalp";
  if (tf === "15m" || tf === "30m" || tf === "1h") return "day trade";
  if (tf === "4h" || tf === "12h" || tf === "1d") return "swing";
  return "position";
}

function holding(tf: Timeframe, atrPct: number, rr: number) {
  // Expected bars to reach TP2 ≈ RR × (risk/ATR). Risk ≈ 1.5 ATR, so bars ≈ 1.5 × RR; add a buffer.
  const bars = Math.max(3, Math.round(rr * 2.2));
  const mins: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "12h": 720, "1d": 1440, "1w": 10080, "1M": 43200 };
  const totalMin = bars * mins[tf];
  const human = totalMin < 120 ? `${totalMin} min` : totalMin < 48 * 60 ? `${Math.round(totalMin / 60)} h` : totalMin < 60 * 24 * 21 ? `${Math.round(totalMin / 1440)} days` : `${Math.round(totalMin / 10080)} weeks`;
  return {
    holdingPeriod: `~${human}`,
    holdingReason: `At the current ATR (${(atrPct * 100).toFixed(2)}% per candle) the TP2 distance (${rr}R) typically takes about ${bars} ${tf} candles to resolve. Re-evaluate if the move stalls beyond that.`,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
