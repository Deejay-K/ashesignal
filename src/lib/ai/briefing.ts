// AI analyst briefings. The numeric engine is the source of truth: the model is given the
// engine's structured output and must only reference numbers that appear in it.

import type { MultiTfAnalysis } from "@/lib/market/analyze";
import type { TimeframeAnalysis } from "@/lib/ta/analysis";
import type { FearGreedPoint } from "@/lib/types";
import { askJson, aiProvider, AI_MODEL } from "./claude";
import { localBriefing, localMarketBriefing } from "./local";

/** Project rule: no em/en dashes anywhere, including model output. */
export function stripDashes<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\s*[\u2014\u2013]\s*/g, "-") as unknown as T;
  if (Array.isArray(v)) return v.map(stripDashes) as unknown as T;
  if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v as object)) o[k] = stripDashes(x); return o as T; }
  return v;
}

export interface Briefing {
  headline: string; // one line
  bottomLine: string; // 2-3 sentences, the verdict
  marketNow: string; // what price is doing across timeframes
  supportingEvidence: string[]; // indicator-backed bullets, each citing a number from the data
  whatNext: string;
  bullishScenario: string;
  bearishScenario: string;
  keyLevels: { level: string; why: string }[];
  entryExit: string; // where/when to act, referencing the engine setup if any
  riskFactors: string[];
  invalidation: string[];
  suitability: "scalp" | "day trade" | "swing" | "position" | "avoid";
  confidence: number; // 0-100, the model's confidence in the read
  disagreements: string; // where the model disagrees with the engine, or "None."
}

const SYSTEM = `You are AsheSignal's senior crypto market analyst. You receive the structured output of a deterministic technical-analysis engine (indicators, levels, patterns, scores, a candidate trade setup) plus context (fundamentals, sentiment, security). Write a clear, specific briefing for a trader.

Hard rules:
- Every price, level, percentage or score you mention MUST appear in the provided data. Never invent, round into a new number, or extrapolate a price. If data is missing, say so.
- Explain WHY: tie every claim to a named indicator, level, pattern or volume fact from the data.
- Distinguish confirmed (completed patterns, level breaks) from unconfirmed (forming, speculative). Never present a forming pattern as a done outcome.
- Where timeframes conflict, say so plainly and tell the trader what that means for position sizing and holding time.
- Be direct and concise. No disclaimers, no "I'm an AI", no hedging filler. Probabilistic language is fine ("likely", "tends to").
- Formatting: never use em dashes or en dashes. Use a plain hyphen (-) or a comma instead.
- If the engine produced no setup, do not manufacture one; explain what would need to happen.
- Reply with ONLY a JSON object with exactly these keys: headline, bottomLine, marketNow, supportingEvidence (array of strings), whatNext, bullishScenario, bearishScenario, keyLevels (array of {level, why}), entryExit, riskFactors (array), invalidation (array), suitability (one of scalp|day trade|swing|position|avoid), confidence (0-100 number), disagreements (string).`;

export interface BriefingContext {
  name: string;
  symbol: string;
  fundamentals?: Record<string, unknown>;
  fng?: FearGreedPoint | null;
  security?: Record<string, unknown> | null;
  analysis: MultiTfAnalysis;
}

/** Trim the engine output to what matters, keeping all numbers the model may cite. */
function compact(a: MultiTfAnalysis) {
  const tfs: Record<string, unknown> = {};
  for (const [tf, t] of Object.entries(a.timeframes)) {
    if ("unavailable" in t) {
      tfs[tf] = { unavailable: t.note };
      continue;
    }
    const x = t as TimeframeAnalysis;
    tfs[tf] = {
      price: x.price,
      outlook: x.outlook,
      score: x.score,
      opportunityScore: x.opportunityScore,
      trend: x.trend,
      momentum: x.momentum,
      volume: { ratio: +x.volume.ratio.toFixed(2), trend: x.volume.trend, note: x.volume.note },
      volatility: { atrPct: +(x.volatility.atrPct * 100).toFixed(2), regime: x.volatility.regime },
      vwap: x.vwap,
      volumePoc: x.volumePoc,
      levels: x.levels.map((l) => ({ price: l.price, kind: l.kind, touches: l.touches })),
      fib: x.fib,
      breakout: x.breakout,
      reasons: x.reasons.map((r) => `${r.weight > 0 ? "+" : ""}${r.weight.toFixed(0)} ${r.text}`),
      patternsConfirmed: x.patterns.confirmed.map((p) => `${p.name} (${p.bias}, conf ${Math.round(p.confidence * 100)}%) ${p.description}`),
      patternsCompleted: x.patterns.completed.map((p) => `${p.name} (${p.bias}) ${p.description}`),
      patternsForming: x.patterns.forming.map((p) => `${p.name} (${p.bias}, unconfirmed) ${p.description}`),
      patternsFailed: [...x.patterns.failed, ...x.patterns.invalidated].map((p) => `${p.name} (${p.status})`),
      weakeningMomentum: x.weakeningMomentum,
      reversalSigns: x.reversalSigns,
      scenarios: x.scenarios,
      setup: x.setup
        ? { side: x.setup.side, kind: x.setup.kind, tradeable: x.setup.quality.tradeable, issues: x.setup.quality.issues, entry: x.setup.entry, takeProfits: x.setup.takeProfits.map((t) => ({ label: t.label, price: t.price, rr: t.rr, basis: t.basis })), stopLosses: x.setup.stopLosses.map((s) => ({ label: s.label, price: s.price, basis: s.basis })), riskRewardTp2: x.setup.riskRewardTp2, confidence: x.setup.confidence, style: x.setup.style, holdingPeriod: x.setup.holdingPeriod, invalidation: x.setup.invalidation, reasons: x.setup.reasons }
        : { none: x.setupReason },
    };
  }
  return { consensus: a.consensus, sources: a.sources, timeframes: tfs };
}

export async function generateBriefing(ctx: BriefingContext) {
  if (aiProvider() === "local") return { data: localBriefing(ctx), model: AI_MODEL(), inputTokens: 0, outputTokens: 0 };
  try {
    const r = await generateBriefingRemote(ctx);
    return { ...r, data: stripDashes(r.data) };
  } catch (e) {
    console.warn("remote briefing failed, using local writer:", (e as Error).message);
    const b = localBriefing(ctx);
    b.disagreements = `(Remote model failed: ${(e as Error).message}. This briefing was written by the local engine writer.)`;
    return { data: b, model: "engine-writer", inputTokens: 0, outputTokens: 0 };
  }
}

async function generateBriefingRemote(ctx: BriefingContext) {
  const user = `Asset: ${ctx.name} (${ctx.symbol})
Generated at: ${new Date().toISOString()}

FUNDAMENTALS (CoinGecko/DexScreener): ${JSON.stringify(ctx.fundamentals ?? {})}
MARKET SENTIMENT (Fear & Greed): ${ctx.fng ? `${ctx.fng.value} - ${ctx.fng.label}` : "unavailable"}
SECURITY (GoPlus, DEX tokens only): ${JSON.stringify(ctx.security ?? null)}

ENGINE OUTPUT (source of truth for every number):
${JSON.stringify(compact(ctx.analysis))}

Write the briefing JSON now.`;
  return askJson<Briefing>(SYSTEM, user, 2000);
}

/* ---------- daily market briefing ---------- */

export interface MarketBriefing {
  headline: string;
  summary: string; // 3-5 sentences
  regime: "risk-on" | "risk-off" | "mixed" | "ranging";
  whatToWatch: string[];
  bullishPicks: { symbol: string; why: string }[];
  bearishPicks: { symbol: string; why: string }[];
  cautions: string[];
}

const MARKET_SYSTEM = `You are AsheSignal's market desk writing the daily crypto briefing from structured data (global stats, Fear & Greed, top movers, unusual volume, and the engine's bullish/bearish 4h picks with scores). Use only numbers present in the data. Be specific and concise; no disclaimers. Never use em dashes or en dashes (use a hyphen). Reply with ONLY a JSON object with keys: headline, summary, regime (risk-on|risk-off|mixed|ranging), whatToWatch (array), bullishPicks (array of {symbol, why}), bearishPicks (array of {symbol, why}), cautions (array).`;

export async function generateMarketBriefing(data: Record<string, unknown>) {
  if (aiProvider() === "local") return { data: localMarketBriefing(data), model: AI_MODEL(), inputTokens: 0, outputTokens: 0 };
  try {
    const r = await generateMarketBriefingRemote(data);
    return { ...r, data: stripDashes(r.data) };
  } catch (e) {
    console.warn("remote market briefing failed, using local writer:", (e as Error).message);
    return { data: localMarketBriefing(data), model: "engine-writer", inputTokens: 0, outputTokens: 0 };
  }
}

async function generateMarketBriefingRemote(data: Record<string, unknown>) {
  return askJson<MarketBriefing>(MARKET_SYSTEM, `Generated at ${new Date().toISOString()}\n\nDATA:\n${JSON.stringify(data)}\n\nWrite the briefing JSON now.`, 1400);
}
