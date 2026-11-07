// Live fallback for the trading discovery hub: computes category cards directly from market data
// when the worker has not filled a table yet (fresh deploy, or no worker configured). Same engine,
// same categorize() rules, just computed on request and cached in memory for a few minutes.

import { getMarkets, getCoin, getMarketChart } from "@/lib/providers/coingecko";

/** Resolve with whatever is ready after ms; the underlying work keeps filling the memo for the next request. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> { return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]); }
export { within };
import { getKlines, getTradingSymbols } from "@/lib/providers/binance";
import { getTrendingPools } from "@/lib/providers/geckoterminal";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";
import { categorize, detailSnapshot } from "./categorize";
import { scanAddress } from "./scan";
import { buildSpecDetail } from "./speculative";
import { buildSpot } from "./spot";
import type { Opportunity } from "./opportunities";

const memo = new Map<string, { at: number; value: Promise<Opportunity[]> }>();
function cached(key: string, ttl: number, fn: () => Promise<Opportunity[]>): Promise<Opportunity[]> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = fn().catch(() => [] as Opportunity[]);
  memo.set(key, { at: Date.now(), value });
  return value;
}

const EXCLUDE = /usd|usdt|usdc|dai|fdusd|tusd|pyusd|usde|wrapped|wbtc|weth|steth|wsteth|cbbtc|reth|weeth|frax|eurc|eurs|xaut|paxg/i;
const GT_TO_DEX: Record<string, string> = { eth: "ethereum", bsc: "bsc", base: "base", solana: "solana", arbitrum: "arbitrum", polygon_pos: "polygon", avax: "avalanche", optimism: "optimism" };

/** Confirmed + Watching for the top N Binance-listed coins on 4h and 1d (about 2N kline calls, cached). */
export function liveTaCategories(n = 40): Promise<Opportunity[]> {
  return cached(`ta:${n}`, 3 * 60_000, async () => {
    const [top, symsR] = await Promise.all([safe(getMarkets(1, 100, false)), safe(getTradingSymbols())]);
    if (!top.ok || !symsR.ok) return [];
    const coins = top.data.filter((c) => symsR.data.has(`${c.symbol}USDT`) && !EXCLUDE.test(c.symbol)).slice(0, n);
    const TFS: Timeframe[] = ["4h", "1d"];
    const now = new Date().toISOString();
    const out: Opportunity[] = [];
    await Promise.all(coins.map(async (c) => {
      const ks = await Promise.all(TFS.map((tf) => safe(getKlines(`${c.symbol}USDT`, tf, 300))));
      ks.forEach((k, i) => {
        if (!k.ok) return;
        const a = analyzeTimeframe(TFS[i], k.data);
        if (!a) return;
        const cat = categorize(a);
        if (cat.category === "none") return;
        const d = detailSnapshot(a, cat);
        const s = a.setup;
        const tp2 = s?.takeProfits[1]?.price ?? s?.takeProfits[0]?.price ?? null;
        out.push({
          id: `cg:${c.id}|${TFS[i]}`, assetKey: `cg:${c.id}`, category: cat.category, symbol: c.symbol, name: c.name, chain: "binance",
          price: a.price, marketCap: c.marketCapUsd, volume24h: c.volume24hUsd, liquidity: c.volume24hUsd, side: s?.side ?? null,
          bias: a.outlook.includes("bull") ? "bullish" : a.outlook.includes("bear") ? "bearish" : "neutral",
          risk: s?.kind === "confirmed" && a.volatility.atrPct < 0.04 ? "low" : a.volatility.atrPct > 0.1 || s?.kind === "watch" ? "high" : "medium",
          timeframe: TFS[i], rr: s?.riskRewardTp2 ?? null, confidence: s?.confidence ?? null,
          upsidePct: tp2 != null && s ? Math.abs((tp2 - s.entry.mid) / s.entry.mid) * 100 : null, tokenCategories: [],
          firstSeen: now, updatedAt: now, href: `/token/${c.id}?tf=${TFS[i]}`,
          detail: d as unknown as Record<string, unknown>, spec: null, spot: null, tier: null,
          liquidityNote: c.volume24hUsd != null && c.marketCapUsd ? `${((c.volume24hUsd / c.marketCapUsd) * 100).toFixed(1)}% of market cap traded in 24h` : null,
        });
      });
    }));
    return out;
  });
}

/** Speculative: the top trending DEX pools right now, fully scanned (slow: ~6 scans). */
export function liveSpeculative(n = 4): Promise<Opportunity[]> {
  return cached(`spec:${n}`, 5 * 60_000, async () => {
    const trend = await safe(getTrendingPools());
    if (!trend.ok) return [];
    const seen = new Set<string>();
    const pools = trend.data.filter((p) => p.baseTokenAddress && GT_TO_DEX[p.network] && (p.liquidityUsd ?? 0) >= 15_000 && !seen.has(p.baseTokenAddress) && seen.add(p.baseTokenAddress)).slice(0, n);
    const now = new Date().toISOString();
    const out: Opportunity[] = [];
    await Promise.all(pools.map(async (p) => {
      const r = await Promise.race([safe(scanAddress(p.baseTokenAddress!, ["1h", "4h"])), new Promise<{ ok: false; error: string }>((res) => setTimeout(() => res({ ok: false, error: "timeout" }), 18_000))]);
      if (!r.ok || !r.data.token || r.data.market.priceUsd == null || (r.data.market.liquidityUsd ?? 0) < 10_000) return;
      if (r.data.security && r.data.security.riskScore >= 90) return;
      const rep = r.data;
      const token = rep.token!; const price = rep.market.priceUsd!;
      const spike = p.volume24h && p.liquidityUsd ? p.volume24h / p.liquidityUsd : null;
      const d = buildSpecDetail(rep, spike != null && spike >= 3 ? "unusual-volume" : "trending", { volumeSpike: spike });
      const tp = d.targets.tp[1]?.price ?? d.targets.tp[0]?.price ?? null;
      out.push({
        id: `addr:${rep.chain?.id ?? GT_TO_DEX[p.network]}:${rep.address.toLowerCase()}`, assetKey: `addr:${rep.chain?.id ?? GT_TO_DEX[p.network]}:${rep.address.toLowerCase()}`, category: "speculative",
        symbol: token.symbol, name: token.name, chain: rep.chain?.id ?? GT_TO_DEX[p.network], price, marketCap: rep.market.marketCap ?? rep.market.fdv,
        volume24h: rep.market.volume24h, liquidity: rep.market.liquidityUsd, side: d.targets.side,
        bias: d.ta ? (d.ta.outlook.includes("bull") ? "bullish" : d.ta.outlook.includes("bear") ? "bearish" : "neutral") : (rep.market.change.h24 ?? 0) > 0 ? "bullish" : "bearish",
        risk: rep.verdict.riskLevel, timeframe: d.ta?.timeframe ?? null, rr: null, confidence: d.targets.justified && d.ta ? Math.round(50 + Math.abs(d.ta.score) / 4) : null,
        upsidePct: tp != null ? Math.abs((tp - price) / price) * 100 : null, tokenCategories: ["trending"],
        firstSeen: now, updatedAt: now, href: `/scanner?address=${encodeURIComponent(rep.address)}`, detail: null, spec: d, spot: null, tier: null, liquidityNote: d.liquidity.note,
      });
    }));
    return out;
  });
}

/** Spot: the top N coins by market cap scored live (2 CoinGecko calls each; keep N small). */
export function liveSpot(n = 6): Promise<Opportunity[]> {
  return cached(`spot:${n}`, 10 * 60_000, async () => {
    const top = await safe(getMarkets(1, 60, false));
    if (!top.ok) return [];
    const coins = top.data.filter((c) => !EXCLUDE.test(c.symbol) && !EXCLUDE.test(c.id) && !EXCLUDE.test(c.name)).slice(0, n);
    const now = new Date().toISOString();
    const out: Opportunity[] = [];
    const btc1y = top.data.find((c) => c.id === "bitcoin")?.change1yPct ?? null;
    const eth1y = top.data.find((c) => c.id === "ethereum")?.change1yPct ?? null;
    for (const c of coins) {
      const [coin, chart] = await Promise.all([safe(getCoin(c.id)), safe(getMarketChart(c.id, 365))]);
      if (!coin.ok || !chart.ok) continue;
      const d = buildSpot({ coin: coin.data, dailyCloses: chart.data.prices.map((p) => p[1]), btc1y, eth1y });
      if (!d || d.score < 40) continue;
      const pt = d.analysis.profitTaking[0]?.price ?? null;
      out.push({
        id: `cg:${c.id}`, assetKey: `cg:${c.id}`, category: "spot", symbol: c.symbol, name: c.name, chain: d.fundamentals.chains[0] ?? null, price: c.priceUsd, marketCap: c.marketCapUsd, volume24h: c.volume24hUsd, liquidity: c.volume24hUsd, side: null,
        bias: d.structure.trend === "up" ? "bullish" : d.structure.trend === "down" ? "bearish" : "neutral", risk: d.tier === "established" ? "low" : d.tier === "emerging" ? "medium" : "high",
        timeframe: "1w", rr: null, confidence: d.score, upsidePct: pt != null && c.priceUsd ? ((pt - c.priceUsd) / c.priceUsd) * 100 : null, tokenCategories: d.fundamentals.categories,
        firstSeen: now, updatedAt: now, href: `/token/${c.id}`, detail: null, spec: null, spot: d, tier: d.tier, liquidityNote: null,
      });
    }
    return out;
  });
}
