// Spot investment engine: fundamentals + weekly structure -> tiered long-term picks with
// accumulation and profit-taking zones, three scenarios, outlooks, risks and a "why" narrative.
// Every number comes from CoinGecko market data and the engine; the narrative is a template
// (optionally rewritten by the configured LLM) and never invents figures.

import type { CoinDetail } from "@/lib/providers/coingecko";
import { sma, fibonacci } from "@/lib/ta/indicators";
import { fmtUsd } from "@/lib/format";
import { askJson, aiProvider } from "@/lib/ai/claude";
import { stripDashes } from "@/lib/ai/briefing";

export type SpotTier = "established" | "emerging" | "speculative";

export interface SpotDetail {
  tier: SpotTier;
  tierNote: string;
  score: number; // 0..100
  scoreParts: { label: string; points: number; max: number; note: string }[];
  why: { interesting: string; problem: string; ecosystem: string; adoption: string; demand: string; bullMarket: string };
  analysis: {
    price: number;
    accumulation: { low: number; high: number; note: string };
    buyingOpportunities: string[];
    profitTaking: { label: string; price: number; note: string }[];
    outlook: { short: string; medium: string; long: string };
    scenarios: { bull: { range: string; text: string }; base: { range: string; text: string }; bear: { range: string; text: string } };
    risks: string[];
  };
  fundamentals: {
    rank: number | null; marketCap: number | null; fdv: number | null; volume24h: number | null; volToMcap: number | null;
    circulatingPct: number | null; maxSupply: number | null; athDistancePct: number | null; athDate: string | null;
    change30d: number | null; change1y: number | null; vsBtc1y: number | null; vsEth1y: number | null;
    twitter: number | null; reddit: number | null; watchlists: number | null; sentimentUp: number | null;
    categories: string[]; chains: string[];
  };
  structure: { sma50w: number | null; sma200d: number | null; weeklyHigh: number; weeklyLow: number; trend: "up" | "down" | "sideways" };
  narrativeSource: "engine" | string;
}

export interface SpotInput {
  coin: CoinDetail;
  dailyCloses: number[]; // oldest -> newest, ideally 365+
  btc1y: number | null; // BTC 1y change %
  eth1y: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function tierFor(c: CoinDetail): { tier: SpotTier; note: string } {
  const mc = c.marketCapUsd ?? 0;
  const rank = c.marketCapRank ?? 9999;
  if (mc >= 10_000_000_000 || rank <= 20) return { tier: "established", note: "Top-20 asset with a multi-cycle track record. Lower upside multiple, far lower chance of going to zero." };
  if (mc >= 500_000_000 || rank <= 120) return { tier: "emerging", note: "Mid cap with a working product and real volume, but not yet proven across a full cycle." };
  return { tier: "speculative", note: "Small cap. Higher potential multiple in a bull market, with real risk of permanent loss." };
}

export function buildSpot(inp: SpotInput): SpotDetail | null {
  const c = inp.coin;
  const price = c.priceUsd;
  if (price == null || !inp.dailyCloses.length) return null;
  const closes = inp.dailyCloses;
  const n = closes.length;
  const weeklyHigh = Math.max(...closes.slice(-365));
  const weeklyLow = Math.min(...closes.slice(-365));
  const s200 = n >= 200 ? sma(closes, 200)[n - 1] : null;
  const s350 = n >= 350 ? sma(closes, 350)[n - 1] : null; // ~50-week
  const s100 = n >= 100 ? sma(closes, 100)[n - 1] : null;
  const trend: SpotDetail["structure"]["trend"] = s200 != null && price > s200 * 1.05 ? "up" : s200 != null && price < s200 * 0.95 ? "down" : "sideways";
  const { tier, note: tierNote } = tierFor(c);

  const volToMcap = c.volume24hUsd != null && c.marketCapUsd ? c.volume24hUsd / c.marketCapUsd : null;
  const circPct = c.circulatingSupply != null && (c.maxSupply ?? c.totalSupply) ? (c.circulatingSupply / (c.maxSupply ?? c.totalSupply!)) * 100 : null;
  const athDist = c.ath != null && c.ath > 0 ? ((price - c.ath) / c.ath) * 100 : null;
  const vsBtc = c.change1yPct != null && inp.btc1y != null ? c.change1yPct - inp.btc1y : null;
  const vsEth = c.change1yPct != null && inp.eth1y != null ? c.change1yPct - inp.eth1y : null;

  // ---- score ----
  const parts: SpotDetail["scoreParts"] = [];
  const add = (label: string, points: number, max: number, note: string) => parts.push({ label, points: Math.round(clamp(points, 0, max)), max, note });
  const mc = c.marketCapUsd ?? 0;
  add("Market position", mc >= 50e9 ? 15 : mc >= 10e9 ? 13 : mc >= 1e9 ? 10 : mc >= 300e6 ? 7 : mc >= 50e6 ? 4 : 2, 15, `Market cap ${fmtUsd(mc, { compact: true })}, rank #${c.marketCapRank ?? "?"}.`);
  add("Liquidity", volToMcap == null ? 0 : volToMcap >= 0.1 ? 12 : volToMcap >= 0.05 ? 10 : volToMcap >= 0.02 ? 7 : volToMcap >= 0.01 ? 4 : 1, 12, `24h volume is ${volToMcap != null ? (volToMcap * 100).toFixed(1) + "% of market cap" : "unknown"}; above 2% means positions can be built and exited.`);
  add("Tokenomics", circPct == null ? 5 : circPct >= 90 ? 12 : circPct >= 70 ? 9 : circPct >= 50 ? 6 : 3, 12, circPct == null ? "No max or total supply published: unlimited emission is a dilution risk." : `${circPct.toFixed(0)}% of supply circulating${circPct < 70 ? ": remaining unlocks will dilute holders" : ": little future dilution"}.`);
  add("Community and adoption", clamp(Math.log10((c.twitterFollowers ?? 1) + 1) * 2 + Math.log10((c.watchlistUsers ?? 1) + 1) * 1.5 - 8, 0, 12), 12, `${c.twitterFollowers ? (c.twitterFollowers / 1000).toFixed(0) + "k followers" : "no follower data"}, ${c.watchlistUsers ? (c.watchlistUsers / 1000).toFixed(0) + "k CoinGecko watchlists" : "no watchlist data"}, sentiment ${c.sentimentUpPct != null ? c.sentimentUpPct.toFixed(0) + "% positive" : "n/a"}.`);
  add("Cycle position", athDist == null ? 5 : athDist <= -70 ? 14 : athDist <= -50 ? 12 : athDist <= -30 ? 9 : athDist <= -15 ? 6 : 3, 14, athDist == null ? "No ATH data." : `${Math.abs(athDist).toFixed(0)}% below the all-time high${athDist <= -50 ? ": deep-drawdown accumulation territory if the project survives" : athDist >= -15 ? ": near the highs, less asymmetric" : ""}.`);
  add("Trend health", trend === "up" ? 10 : trend === "sideways" ? 7 : 4, 10, `Price is ${trend === "up" ? "above" : trend === "down" ? "below" : "around"} the 200-day average${s350 != null ? ` and ${price > s350 ? "above" : "below"} the 50-week average` : ""}.`);
  add("Relative strength vs BTC/ETH", vsBtc == null ? 4 : vsBtc > 30 ? 10 : vsBtc > 0 ? 8 : vsBtc > -30 ? 5 : 2, 10, vsBtc == null ? "Not enough 1y history to compare." : `${vsBtc >= 0 ? "Outperformed" : "Underperformed"} BTC by ${Math.abs(vsBtc).toFixed(0)} points over 1y${vsEth != null ? `, ${vsEth >= 0 ? "ahead of" : "behind"} ETH by ${Math.abs(vsEth).toFixed(0)}` : ""}.`);
  add("Historical resilience", c.change1yPct == null ? 5 : c.change1yPct > 0 ? 10 : c.change1yPct > -40 ? 7 : c.change1yPct > -70 ? 4 : 1, 10, c.change1yPct == null ? "No 1y data." : `${c.change1yPct >= 0 ? "+" : ""}${c.change1yPct.toFixed(0)}% over one year, ${c.change30dPct != null ? `${c.change30dPct >= 0 ? "+" : ""}${c.change30dPct.toFixed(0)}% over 30 days` : ""}.`);
  const utilityCats = c.categories.filter((k) => /layer|smart contract|defi|exchange|oracle|infrastructure|interoperability|storage|ai|real world|payments|gaming|liquid staking|stablecoin/i.test(k));
  add("Utility signals", utilityCats.length ? 5 : c.categories.some((k) => /meme/i.test(k)) ? 0 : 2, 5, utilityCats.length ? `Categories: ${utilityCats.slice(0, 3).join(", ")}.` : c.categories.some((k) => /meme/i.test(k)) ? "Memecoin: value is attention, not utility." : "No clear utility category tagged.");
  const score = clamp(Math.round(parts.reduce((a, p) => a + p.points, 0)), 0, 100);

  // ---- zones ----
  const fib = fibonacci(weeklyHigh, weeklyLow, "up"); // retracement levels from the 1y range
  const f618 = fib.find((f) => f.ratio === 0.618)!.price;
  const f786 = fib.find((f) => f.ratio === 0.786)!.price;
  const candidates = [s200, s350, f618, f786, s100].filter((v): v is number => v != null && v > 0 && v < price * 1.02);
  const accLow = candidates.length ? Math.min(...candidates) : price * 0.75;
  const accHigh = candidates.length ? Math.max(...candidates) : price * 0.9;
  const accumulation = {
    low: Math.min(accLow, price * 0.97),
    high: Math.min(accHigh, price),
    note: price <= accHigh && price >= accLow ? "Price is inside the accumulation zone now." : price < accLow ? "Price is below the zone: the market is weaker than the structure suggests; scale in slowly, do not go all in." : `Zone sits ${(((price - accHigh) / price) * 100).toFixed(0)}% to ${(((price - accLow) / price) * 100).toFixed(0)}% below the current price; wait for pullbacks or use small recurring buys.`,
  };
  const buying: string[] = [];
  if (s200 != null) buying.push(`Retest of the 200-day average at ${fmtUsd(s200)}.`);
  if (s350 != null) buying.push(`50-week average at ${fmtUsd(s350)}: the classic cycle support.`);
  buying.push(`0.618 retracement of the 1y range at ${fmtUsd(f618)}.`);
  buying.push("Recurring buys (DCA) through the whole accumulation zone instead of one entry.");
  if (athDist != null && athDist <= -60) buying.push("Deep drawdown from ATH: historically where long-term entries in surviving projects paid best.");
  const profitTaking: SpotDetail["analysis"]["profitTaking"] = [];
  const pushTp = (label: string, p: number, note: string) => { if (p > price * 1.05) profitTaking.push({ label, price: p, note }); };
  pushTp("Range high", weeklyHigh, "Top of the last year's range; first place to trim.");
  if (c.ath != null) pushTp("All-time high", c.ath, "Prior cycle peak; expect heavy supply here.");
  if (c.ath != null) pushTp("1.618 extension", c.ath + (c.ath - weeklyLow) * 0.618, "Fibonacci extension above the ATH for a bull-market blow-off.");
  if (c.ath != null) pushTp("2.618 extension", c.ath + (c.ath - weeklyLow) * 1.618, "Euphoria target; only reached in strong cycles.");
  if (!profitTaking.length) pushTp("1.5x", price * 1.5, "No structural target above; trim at round multiples.");

  // ---- scenarios ----
  const mult = tier === "established" ? [2, 3.5] : tier === "emerging" ? [3, 8] : [5, 20];
  const bullLow = Math.max(price * mult[0], c.ath ?? 0);
  const scenarios = {
    bull: { range: `${fmtUsd(bullLow)} to ${fmtUsd(price * mult[1])}`, text: `Liquidity returns to crypto, BTC makes new highs and capital rotates into ${tier === "established" ? "majors first" : "mid and small caps after majors run"}. ${c.name} ${c.ath != null && price < c.ath ? "reclaims its ATH " + fmtUsd(c.ath) + " and " : ""}trades at ${mult[0]}x to ${mult[1]}x the current price. Take profit in tranches at the zones above; do not wait for a top.` },
    base: { range: `${fmtUsd(price * 0.8)} to ${fmtUsd(price * (tier === "established" ? 1.8 : 2.5))}`, text: `Choppy, range-bound market with slow adoption growth. ${c.name} grinds between the accumulation zone and the range high. Returns come from buying the low end of the zone and trimming at the top of it.` },
    bear: { range: `${fmtUsd(Math.min(weeklyLow, price * 0.45))} to ${fmtUsd(price * 0.7)}`, text: `Risk-off macro, BTC loses its 200-day average and altcoins fall harder. ${c.name} drops 30% to ${tier === "speculative" ? "80" : "60"}% and holds there for months.${tier === "speculative" ? " For a small cap, permanent loss is possible if the team stops shipping." : ""} Only money that can sit through this belongs in spot.` },
  };
  const outlook = {
    short: `Weeks: ${c.change30dPct != null ? `${c.change30dPct >= 0 ? "+" : ""}${c.change30dPct.toFixed(0)}% over 30 days; ` : ""}${trend === "up" ? "trend is up, pullbacks toward the zone are buying chances." : trend === "down" ? "trend is down, no rush; let price reach the zone." : "no trend, range trading between the zone and the range high."}`,
    medium: `Months: hinges on holding the ${s350 != null ? "50-week average " + fmtUsd(s350) : "accumulation zone"} and on BTC's direction; ${athDist != null ? `${Math.abs(athDist).toFixed(0)}% below ATH leaves ${athDist <= -40 ? "a lot of" : "limited"} room to recover before meeting old supply.` : ""}`,
    long: `Cycle: ${tier === "established" ? "a core position candidate; sized as the anchor of a spot portfolio." : tier === "emerging" ? "a satellite position; attractive if adoption keeps growing through the cycle." : "a small, speculative allocation; the thesis must be re-checked every quarter."} ${scenarios.bull.range} in a strong bull case.`,
  };
  const risks: string[] = [];
  if (circPct != null && circPct < 70) risks.push(`Only ${circPct.toFixed(0)}% of supply circulating: unlock schedules can cap rallies.`);
  if (circPct == null) risks.push("No supply cap: inflationary token.");
  if (volToMcap != null && volToMcap < 0.02) risks.push("Low turnover for its size: a crowded exit would be slow.");
  if (c.categories.some((k) => /meme/i.test(k))) risks.push("Memecoin: no cash flow or utility; value depends on attention cycles.");
  if (vsBtc != null && vsBtc < -20) risks.push("Has lagged BTC over the past year; it may keep underperforming the simplest alternative.");
  if (tier === "speculative") risks.push("Small cap: team, security and funding risk are real; projects die in bear markets.");
  if (c.tickers.length && c.tickers.filter((t) => t.trustScore === "green").length < 3) risks.push("Few high-trust exchange listings.");
  risks.push("Regulatory and exchange-delisting risk apply to every token.");
  risks.push("Crypto spot drawdowns of 70% to 90% have happened to nearly every asset, majors included.");

  const desc = (c.description ?? "").replace(/<[^>]+>/g, "").split(/(?<=\.)\s/).filter(Boolean);
  const first = desc[0]?.slice(0, 260) ?? `${c.name} is a ${c.categories[0] ?? "crypto"} asset.`;
  const why = {
    interesting: `${first} It ranks #${c.marketCapRank ?? "?"} by market cap${c.categories.length ? ` in ${c.categories.slice(0, 3).join(", ")}` : ""}.`,
    problem: desc[1]?.slice(0, 260) ?? (utilityCats.length ? `It serves the ${utilityCats[0].toLowerCase()} segment.` : "Its use case is not well documented; treat the thesis as market-driven rather than utility-driven."),
    ecosystem: Object.keys(c.platforms).filter(Boolean).length > 1 ? `Deployed on ${Object.keys(c.platforms).filter(Boolean).length} chains (${Object.keys(c.platforms).filter(Boolean).slice(0, 4).join(", ")}): the token travels with its ecosystem.` : c.categories.some((k) => /layer 1|smart contract platform/i.test(k)) ? "It is a base layer: ecosystem growth shows up directly as demand for the token." : "Single-chain token; growth depends on its own product rather than ecosystem spread.",
    adoption: `${c.watchlistUsers ? `${(c.watchlistUsers / 1000).toFixed(0)}k people track it on CoinGecko` : "Tracking data unavailable"}${c.twitterFollowers ? `, ${(c.twitterFollowers / 1000).toFixed(0)}k follow it on X` : ""}; 24h volume ${fmtUsd(c.volume24hUsd, { compact: true })} is ${volToMcap != null ? (volToMcap * 100).toFixed(1) + "% of market cap" : "n/a"}.`,
    demand: utilityCats.length ? `Demand comes from usage (${utilityCats.slice(0, 2).join(", ").toLowerCase()}) plus speculative flows when the sector is in favour.` : "Demand is mostly speculative flow and narrative; it tends to arrive late in the cycle and leave fast.",
    bullMarket: tier === "established" ? "Majors absorb the first wave of new capital in a bull market and have the deepest liquidity for large buyers." : tier === "emerging" ? "Mid caps historically outperform majors in the middle of a bull market once BTC consolidates and capital rotates." : "Small caps see the largest multiples late in a bull run, but also give most of it back; timing exits matters more than entries.",
  };

  return {
    tier, tierNote, score, scoreParts: parts, why,
    analysis: { price, accumulation, buyingOpportunities: buying, profitTaking, outlook, scenarios, risks },
    fundamentals: { rank: c.marketCapRank, marketCap: c.marketCapUsd, fdv: c.fdvUsd, volume24h: c.volume24hUsd, volToMcap, circulatingPct: circPct, maxSupply: c.maxSupply, athDistancePct: athDist, athDate: c.athDate, change30d: c.change30dPct, change1y: c.change1yPct, vsBtc1y: vsBtc, vsEth1y: vsEth, twitter: c.twitterFollowers, reddit: c.redditSubscribers, watchlists: c.watchlistUsers, sentimentUp: c.sentimentUpPct, categories: c.categories.slice(0, 8), chains: Object.keys(c.platforms).filter(Boolean).slice(0, 8) },
    structure: { sma50w: s350, sma200d: s200, weeklyHigh, weeklyLow, trend },
    narrativeSource: "engine",
  };
}

/** Optional: let the configured LLM rewrite the "why" block in better prose, numbers untouched. */
export async function polishWhy(d: SpotDetail, coinName: string): Promise<SpotDetail> {
  if (aiProvider() === "local") return d;
  try {
    const r = await askJson<SpotDetail["why"]>(
      "You are a crypto research writer. Rewrite the six fields of the JSON 'why' block for a long-term spot investment page into clear, specific, neutral prose, 1 to 2 sentences each. Keep every number exactly as given, add no new numbers, no price predictions, no hype. Never use em dashes or en dashes; use plain hyphens or commas. Return only JSON with the same six keys.",
      `Project: ${coinName}\nTier: ${d.tier}\nCategories: ${d.fundamentals.categories.join(", ")}\n\n${JSON.stringify(d.why)}`,
      700,
    );
    const w = stripDashes(r.data);
    if (w && typeof w.interesting === "string") return { ...d, why: { ...d.why, ...w }, narrativeSource: r.model };
  } catch { /* keep engine text */ }
  return d;
}
