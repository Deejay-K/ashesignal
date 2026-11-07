// Zero-cost briefing writer: composes the same Briefing / MarketBriefing shapes from the
// engine output with templated prose. Used when no LLM provider is configured, and as the
// fallback when a remote provider errors. Every number comes straight from the engine.

import type { Briefing, BriefingContext, MarketBriefing } from "./briefing";
import type { TimeframeAnalysis } from "@/lib/ta/analysis";
import { fmtPct, fmtUsd } from "@/lib/format";

const tfOrder = ["15m", "1h", "4h", "1d"];

export function localBriefing(ctx: BriefingContext): Briefing {
  const tfs = tfOrder.map((tf) => [tf, ctx.analysis.timeframes[tf]] as const).filter(([, t]) => t && !("unavailable" in t)) as [string, TimeframeAnalysis][];
  const c = ctx.analysis.consensus;
  const primary = tfs.find(([tf]) => tf === "4h") ?? tfs[tfs.length - 1];
  const [ptf, p] = primary;
  const price = p.price;
  const setupTf = tfs.find(([, t]) => t.setup?.kind === "confirmed") ?? tfs.find(([, t]) => t.setup) ?? null;
  const s = setupTf?.[1].setup ?? null;
  const stf = setupTf?.[0];

  const trendWords = tfs.map(([tf, t]) => `${tf}: ${t.outlook} (${t.score > 0 ? "+" : ""}${t.score})`).join(", ");
  const marketNow = `${ctx.name} trades at ${fmtUsd(price)}. ${c.summary} Per timeframe — ${trendWords}. On ${ptf} the trend is ${p.trend.direction} with RSI ${p.momentum.rsi.toFixed(0)}, volume at ${p.volume.ratio.toFixed(1)}× its 20-period average and ATR ${(p.volatility.atrPct * 100).toFixed(2)}% (${p.volatility.regime} volatility).`;

  const evidence: string[] = [];
  for (const [tf, t] of tfs) {
    const top = [...t.reasons].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, tf === ptf ? 4 : 2);
    for (const r of top) evidence.push(`${tf} (${r.weight > 0 ? "+" : ""}${r.weight.toFixed(0)}): ${r.text}`);
  }
  for (const [tf, t] of tfs) for (const pat of t.patterns.completed.slice(0, 1)) evidence.push(`${tf} pattern completed: ${pat.name} — ${pat.description}`);

  const supportLv = p.levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price);
  const resLv = p.levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price);
  const keyLevels = [
    ...resLv.slice(0, 2).map((l) => ({ level: fmtUsd(l.price), why: `${ptf} resistance, ${l.touches} touch${l.touches > 1 ? "es" : ""} (${fmtPct(((l.price - price) / price) * 100, 1)} away)` })),
    ...supportLv.slice(0, 2).map((l) => ({ level: fmtUsd(l.price), why: `${ptf} support, ${l.touches} touch${l.touches > 1 ? "es" : ""} (${fmtPct(((l.price - price) / price) * 100, 1)} away)` })),
    ...(p.vwap != null ? [{ level: fmtUsd(p.vwap), why: `rolling VWAP on ${ptf} — price is ${price > p.vwap ? "above" : "below"} it` }] : []),
    ...(p.trend.sma200 != null ? [{ level: fmtUsd(p.trend.sma200), why: `200 SMA on ${ptf} — long-term bias ${price > p.trend.sma200 ? "up" : "down"}` }] : []),
  ];

  const forming = tfs.flatMap(([tf, t]) => t.patterns.forming.map((x) => `${tf}: ${x.name} (${x.bias}) is forming but unconfirmed — ${x.description}`));
  const whatNext = `${p.scenarios.bullish} ${p.scenarios.bearish}${forming.length ? ` Unconfirmed structure to watch — ${forming.slice(0, 2).join(" ")}` : ""}`;

  let entryExit: string;
  if (s && stf) {
    entryExit = `${s.kind === "confirmed" ? "Confirmed" : "Speculative"} ${s.side} on ${stf}: ${s.entry.type} entry ${fmtUsd(s.entry.low)}–${fmtUsd(s.entry.high)}, stop ${fmtUsd(s.stopLosses[0].price)} (${s.stopLosses[0].basis}), targets ${s.takeProfits.map((t) => `${t.label} ${fmtUsd(t.price)} (${t.rr}R)`).join(", ")}. ${s.riskRewardTp2}R to TP2 at ${s.confidence}% confidence; ${s.style} style, expected hold ${s.holdingPeriod}. ${s.reasons.join(" ")}`;
  } else {
    const why = tfs.map(([tf, t]) => `${tf}: ${t.setupReason}`).join(" ");
    entryExit = `No setup qualifies right now. ${why} Wait for a close through ${resLv[0] ? fmtUsd(resLv[0].price) : "the swing high"} (long) or ${supportLv[0] ? fmtUsd(supportLv[0].price) : "the swing low"} (short) on above-average volume.`;
  }

  const risks: string[] = [];
  if (c.alignment === "conflicting") risks.push("Timeframes conflict — lower-timeframe trades are counter-trend; size down and take profit early.");
  if (p.volatility.regime === "expanded") risks.push(`Volatility is expanded (ATR ${(p.volatility.atrPct * 100).toFixed(2)}%) — stops get hit by noise more often.`);
  if (p.volatility.regime === "squeeze") risks.push("Bollinger squeeze — the next move can be fast in either direction; don't assume the direction before the break.");
  if (p.momentum.rsi >= 70) risks.push(`RSI ${p.momentum.rsi.toFixed(0)} is overbought on ${ptf}.`);
  if (p.momentum.rsi <= 30) risks.push(`RSI ${p.momentum.rsi.toFixed(0)} is oversold on ${ptf} — bounces can be sharp.`);
  if (p.volume.trend === "falling" && p.trend.direction !== "sideways") risks.push(`Volume is fading while the ${ptf} trend is ${p.trend.direction} — participation is thinning.`);
  for (const w of p.weakeningMomentum) risks.push(w);
  if (ctx.fng && (ctx.fng.value >= 76 || ctx.fng.value <= 24)) risks.push(`Market sentiment is ${ctx.fng.label} (${ctx.fng.value}) — extremes often precede reversals.`);
  if (ctx.security && (ctx.security as { riskScore?: number }).riskScore != null && (ctx.security as { riskScore: number }).riskScore >= 25) risks.push(`Contract risk score ${(ctx.security as { riskScore: number }).riskScore}/100 — ${(ctx.security as { summary?: string }).summary ?? ""}`);
  const flags = (ctx.fundamentals as { tradingFlags?: string[] })?.tradingFlags ?? [];
  for (const f of flags) risks.push(f);
  if (!risks.length) risks.push("No elevated risk flags from the engine; normal market risk applies.");

  const invalidation = s ? [...s.invalidation] : [`A ${ptf} close beyond ${supportLv[0] ? fmtUsd(supportLv[0].price) : "the nearest support"} / ${resLv[0] ? fmtUsd(resLv[0].price) : "resistance"} changes the structure.`];
  for (const [tf, t] of tfs) if (t.breakout.type) invalidation.push(`${tf} ${t.breakout.type} at ${fmtUsd(t.breakout.level!)} failing (price closing back through it) would negate that signal.`);

  const suitability: Briefing["suitability"] = s ? s.style : c.alignment === "conflicting" || p.volatility.regime === "expanded" ? "avoid" : "swing";
  const confidence = Math.round(Math.min(90, Math.max(20, (s ? s.confidence : 35) * (c.alignment === "conflicting" ? 0.8 : 1))));

  const dir = c.alignment.includes("bullish") ? "bullish" : c.alignment.includes("bearish") ? "bearish" : c.alignment === "conflicting" ? "mixed" : "neutral";
  const headline = s ? `${ctx.symbol}: ${s.kind} ${s.side.toLowerCase()} setup on ${stf} inside a ${dir} multi-timeframe picture` : `${ctx.symbol}: ${dir} picture, no qualifying setup yet`;
  const bottomLine = s
    ? `The engine's best edge is the ${stf} ${s.side.toLowerCase()} with ${s.riskRewardTp2}R to TP2. ${c.alignment === "conflicting" ? "It runs against the higher timeframe, so treat it as a quick trade, not a position." : c.alignment.startsWith("aligned") ? "Higher and lower timeframes agree, which supports holding for the full targets." : "The broader picture is neutral; take profits at TP1/TP2 rather than waiting for extension."}`
    : `Nothing worth risking capital on yet: ${c.summary} Let price resolve the key levels first.`;

  return { headline, bottomLine, marketNow, supportingEvidence: evidence.slice(0, 10), whatNext, bullishScenario: p.scenarios.bullish, bearishScenario: p.scenarios.bearish, keyLevels, entryExit, riskFactors: risks.slice(0, 8), invalidation: invalidation.slice(0, 6), suitability, confidence, disagreements: "None — this briefing is written directly from the engine output (no external model configured)." };
}

export function localMarketBriefing(d: Record<string, unknown>): MarketBriefing {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const g = d.global as any;
  const fg = d.fearGreed as any;
  const bull = ((d.bullishPicks4h ?? []) as any[]).slice(0, 5);
  const bear = ((d.bearishPicks4h ?? []) as any[]).slice(0, 5);
  const gain = ((d.gainers ?? []) as any[]).slice(0, 3);
  const lose = ((d.losers ?? []) as any[]).slice(0, 3);
  const vol = ((d.unusualVolume ?? []) as any[]).slice(0, 3);
  const dex = ((d.dexTrending ?? []) as any[]).slice(0, 3);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const chg = g?.marketCapChange24hPct as number | undefined;
  const fv = fg?.today?.value as number | undefined;
  const regime: MarketBriefing["regime"] = chg != null && fv != null ? (chg > 1 && fv >= 50 ? "risk-on" : chg < -1 && fv < 50 ? "risk-off" : Math.abs(chg) < 0.5 ? "ranging" : "mixed") : "mixed";
  const summary = [
    g ? `Total crypto market cap is ${fmtUsd(g.totalMarketCapUsd, { compact: true })} (${fmtPct(chg)} in 24h) on ${fmtUsd(g.totalVolume24hUsd, { compact: true })} volume; BTC dominance ${g.btcDominancePct?.toFixed(1)}%, ETH ${g.ethDominancePct?.toFixed(1)}%.` : "Global market data unavailable.",
    fg ? `Fear & Greed is ${fg.today.value} (${fg.today.label}), ${fg.weekAgo ? `${fg.today.value - fg.weekAgo.value >= 0 ? "up" : "down"} from ${fg.weekAgo.value} a week ago` : ""}.` : "",
    bull.length ? `The 4h engine favours ${bull.map((b) => b.symbol).join(", ")}${bear.length ? ` and reads ${bear.map((b) => b.symbol).join(", ")} as weak` : ""}.` : "The 4h engine has no strong directional picks right now.",
  ].filter(Boolean).join(" ");
  return {
    headline: `${regime === "risk-on" ? "Risk-on" : regime === "risk-off" ? "Risk-off" : regime === "ranging" ? "Range-bound" : "Mixed"} tape: market ${fmtPct(chg)} with sentiment at ${fv ?? "?"}`,
    summary,
    regime,
    whatToWatch: [
      ...gain.map((x) => `${x.symbol} leads gainers at ${fmtPct(x.change24hPct, 1)} — check whether volume confirms before chasing.`),
      ...lose.map((x) => `${x.symbol} is ${fmtPct(x.change24hPct, 1)} — watch for capitulation volume or a bearish continuation.`),
      ...vol.map((x) => `${x.symbol}: ${x.metric}.`),
      ...dex.map((x) => `DEX trend ${x.symbol} on ${x.chain} (${x.risk} risk, liquidity ${fmtUsd(x.liquidityUsd, { compact: true })}).`),
    ].slice(0, 8),
    bullishPicks: bull.map((b) => ({ symbol: b.symbol, why: b.metric })),
    bearishPicks: bear.map((b) => ({ symbol: b.symbol, why: b.metric })),
    cautions: [fv != null && fv >= 76 ? "Extreme Greed — crowded longs; tighten stops." : fv != null && fv <= 24 ? "Extreme Fear — capitulation territory; look for reversal patterns before buying." : "", dex.some((x) => x.risk === "extreme") ? "Trending DEX tokens include extreme-risk micro-caps." : ""].filter(Boolean),
  };
}
