// Speculative opportunity builder: turns a full address scan into a stored card with
// attention reasons, momentum, scenarios, zones, targets (only when justifiable) and risks.

import type { ScanReport } from "./scan";
import type { TimeframeAnalysis } from "@/lib/ta/analysis";
import { fmtUsd } from "@/lib/format";

export type SpecSource = "trending" | "new" | "unusual-volume" | "boosted" | "watch";

export interface SpecDetail {
  attention: string[];
  momentum: { change1h: number | null; change24h: number | null; buySellRatio: number | null; txns24h: number; note: string };
  liquidity: { liquidityUsd: number | null; volume24h: number | null; volToLiq: number | null; note: string };
  marketCap: { marketCap: number | null; fdv: number | null; note: string };
  age: { hours: number | null; note: string };
  catalysts: string[];
  scenarios: { bullish: string; bearish: string };
  zones: { entry: string; exit: string };
  targets: { tp: { label: string; price: number }[]; sl: { label: string; price: number }[]; side: "LONG" | "SHORT" | null; justified: boolean; note: string };
  risks: string[];
  security: { score: number | null; summary: string; flags: string[] } | null;
  ta: { timeframe: string; outlook: string; score: number } | null;
  links: { dexscreener?: string; website?: string };
}

function tfOf(r: ScanReport, tf: string): TimeframeAnalysis | null {
  const t = r.analysis?.timeframes[tf];
  return t && !("unavailable" in t) ? t : null;
}

export function buildSpecDetail(r: ScanReport, source: SpecSource, extra: { volumeSpike?: number | null } = {}): SpecDetail {
  const m = r.market;
  const attention: string[] = [];
  if (source === "trending") attention.push("Trending on GeckoTerminal: one of the most traded pools across DEXs right now.");
  if (source === "new") attention.push("Newly created pool: launched within the last day.");
  if (source === "boosted") attention.push("Promoted (boosted) on DexScreener: paid visibility, treat the attention as bought, not organic.");
  if (source === "unusual-volume" || (extra.volumeSpike != null && extra.volumeSpike >= 3)) attention.push(`Unusual volume: 24h volume is ${extra.volumeSpike?.toFixed(1) ?? ">3"}x the pool's liquidity.`);
  if (m.change.h24 != null && Math.abs(m.change.h24) >= 30) attention.push(`${m.change.h24 > 0 ? "Up" : "Down"} ${Math.abs(m.change.h24).toFixed(0)}% in 24h.`);
  if (m.change.h1 != null && Math.abs(m.change.h1) >= 10) attention.push(`${m.change.h1 > 0 ? "Up" : "Down"} ${Math.abs(m.change.h1).toFixed(0)}% in the last hour.`);
  if (m.buySellRatio24h != null && m.buySellRatio24h >= 1.4) attention.push(`Buyers dominate: ${m.buySellRatio24h.toFixed(2)} buys per sell over 24h.`);
  if (!attention.length) attention.push("Small-cap token with active DEX trading.");

  const volToLiq = m.volume24h != null && m.liquidityUsd ? m.volume24h / m.liquidityUsd : null;
  const liqNote = m.liquidityUsd == null ? "Liquidity unknown." : m.liquidityUsd < 20_000 ? "Very thin liquidity: even small orders move price and exits can be hard." : m.liquidityUsd < 100_000 ? "Thin liquidity: expect slippage above a few hundred dollars." : m.liquidityUsd < 1_000_000 ? "Moderate liquidity for a small cap." : "Deep liquidity for this market segment.";
  const momNote = m.change.h1 == null ? "No short-term momentum data." : m.change.h1 > 5 && (m.change.h24 ?? 0) > 0 ? "Momentum is positive on both the 1h and 24h windows." : m.change.h1 < -5 && (m.change.h24 ?? 0) < 0 ? "Momentum is negative on both windows: selling pressure." : (m.change.h1 ?? 0) * (m.change.h24 ?? 0) < 0 ? "Short-term momentum disagrees with the 24h direction: a possible turn." : "Momentum is mixed or flat.";
  const mcapNote = m.marketCap == null && m.fdv == null ? "Market cap not reported." : (m.marketCap ?? m.fdv ?? 0) < 1_000_000 ? "Micro cap under $1M: extreme volatility and manipulation risk." : (m.marketCap ?? m.fdv ?? 0) < 10_000_000 ? "Micro cap under $10M." : (m.marketCap ?? m.fdv ?? 0) < 100_000_000 ? "Small cap under $100M." : "Mid cap; less speculative than the rest of this list.";
  const ageNote = m.ageHours == null ? "Age unknown." : m.ageHours < 24 ? "Under one day old: most new pools lose the majority of their value within days." : m.ageHours < 24 * 7 ? "Under a week old: survivorship is far from proven." : m.ageHours < 24 * 90 ? `${Math.round(m.ageHours / 24)} days old: has survived the launch phase.` : `${Math.round(m.ageHours / 24 / 30)} months old: an established small cap.`;

  const catalysts: string[] = [];
  if (r.token?.socials?.length) catalysts.push(`Active socials (${r.token.socials.map((s) => s.type).join(", ")}): narrative-driven moves are possible.`);
  if (r.token?.websites?.length) catalysts.push("Has a website and public presence.");
  if (m.pairCount > 2) catalysts.push(`Listed on ${m.pairCount} DEX pairs: wider distribution.`);
  if (r.whales && r.whales.transfers.length) catalysts.push(`${r.whales.transfers.length} large transfers seen recently: whale interest.`);
  if (!catalysts.length) catalysts.push("No identifiable catalyst beyond trading activity itself.");

  const ta = tfOf(r, "4h") ?? tfOf(r, "1h");
  const s = ta?.setup ?? null;
  const justified = !!(ta && s && s.kind !== "watch" && m.liquidityUsd != null && m.liquidityUsd >= 50_000 && (m.ageHours ?? 0) >= 72);
  const targets: SpecDetail["targets"] = {
    side: s?.side ?? null,
    tp: justified && s ? s.takeProfits.slice(0, 3).map((t) => ({ label: t.label, price: t.price })) : [],
    sl: justified && s ? s.stopLosses.map((t) => ({ label: t.label, price: t.price })) : [],
    justified,
    note: justified ? `Targets from the ${ta!.timeframe} technical setup (${s!.kind}); confidence ${s!.confidence}%.` : !ta ? "Not enough price history for technical targets." : m.liquidityUsd != null && m.liquidityUsd < 50_000 ? "Liquidity too thin for technical targets to mean anything." : (m.ageHours ?? 0) < 72 ? "Token too young for technical targets; wait for 3 days of candles." : "Setup is only at watch quality; no targets published.",
  };

  const scen = ta?.scenarios ?? { bullish: `Volume keeps growing and the token breaks its recent high with buyers in control; speculative upside of 2x or more is possible in this market segment but far from assured.`, bearish: `Attention fades, early holders sell into thin liquidity and the price retraces most of the move; new tokens often lose 70% or more.` };
  const sup = ta?.levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price)[0];
  const res = ta?.levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price)[0];
  const zones = {
    entry: sup && ta ? `Pullback toward support ${fmtUsd(sup.price)} (${(((sup.price - ta.price) / ta.price) * 100).toFixed(1)}% from price); avoid chasing green candles.` : "No tested support yet: if you enter at all, scale in with small size and expect a drawdown.",
    exit: res && ta ? `First resistance ${fmtUsd(res.price)} (+${(((res.price - ta.price) / ta.price) * 100).toFixed(1)}%); take partial profit there and move the stop up.` : "No tested resistance: sell into strength in tranches rather than waiting for a target.",
  };

  const risks: string[] = [];
  if (m.liquidityUsd != null && m.liquidityUsd < 100_000) risks.push("Thin liquidity: slippage and the possibility of not being able to exit at the shown price.");
  if (m.ageHours != null && m.ageHours < 24 * 7) risks.push("Very new token: rug pulls and abandonment are common in the first week.");
  if (r.security) {
    if (r.security.riskScore >= 60) risks.push("Contract security score is poor (see security section).");
    if (r.security.holders.top10Pct != null && r.security.holders.top10Pct > 50) risks.push(`Top 10 holders own ${r.security.holders.top10Pct.toFixed(0)}% of supply: concentrated and dumpable.`);
    if (r.security.holders.creatorPct != null && r.security.holders.creatorPct > 10) risks.push(`Creator holds ${r.security.holders.creatorPct.toFixed(0)}%.`);
    if ((r.security.taxes.sellPct ?? 0) > 5) risks.push(`Sell tax ${r.security.taxes.sellPct}%.`);
    for (const c of r.security.checks.filter((c) => c.status === "fail").slice(0, 4)) risks.push(c.label + ": " + c.detail);
  } else risks.push("No contract security report available for this chain.");
  for (const f of r.tradingActivity.flags.slice(0, 3)) risks.push(f);
  if (source === "boosted") risks.push("Paid promotion: attention may be entirely bought.");
  risks.push("Speculative category: position size should be money you can afford to lose entirely.");

  return {
    attention,
    momentum: { change1h: m.change.h1, change24h: m.change.h24, buySellRatio: m.buySellRatio24h, txns24h: m.txns24h, note: momNote },
    liquidity: { liquidityUsd: m.liquidityUsd, volume24h: m.volume24h, volToLiq, note: liqNote },
    marketCap: { marketCap: m.marketCap, fdv: m.fdv, note: mcapNote },
    age: { hours: m.ageHours, note: ageNote },
    catalysts,
    scenarios: scen,
    zones,
    targets,
    risks,
    security: r.security ? { score: r.security.riskScore, summary: r.security.summary, flags: r.security.checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => `${c.label} (${c.status})`) } : null,
    ta: ta ? { timeframe: ta.timeframe, outlook: ta.outlook, score: ta.score } : null,
    links: { dexscreener: r.pairs[0]?.url, website: r.token?.websites?.[0] },
  };
}
