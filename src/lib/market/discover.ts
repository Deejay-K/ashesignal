// Opportunity discovery: scans Binance USDT tickers for unusual volume / gainers
// / losers / recovery candidates, pulls CoinGecko trending and DEX trending/new
// pools, and runs the 4h analysis on the strongest candidates for bull/bear picks.

import * as binance from "@/lib/providers/binance";
import * as cg from "@/lib/providers/coingecko";
import * as gt from "@/lib/providers/geckoterminal";
import { safe } from "@/lib/fetch";
import { analyzeTimeframe } from "@/lib/ta/analysis";

export interface DiscoverItem {
  symbol: string;
  name?: string;
  id?: string; // coingecko id when known
  priceUsd: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
  chain?: string;
  address?: string;
  pool?: { network: string; address: string };
  risk: "low" | "medium" | "high" | "extreme";
  riskNote: string;
  metric?: string; // human-readable why it's here
  score?: number;
  source: string;
}

export interface DiscoverResult {
  trending: DiscoverItem[];
  dexTrending: DiscoverItem[];
  newPools: DiscoverItem[];
  unusualVolume: DiscoverItem[];
  gainers: DiscoverItem[];
  losers: DiscoverItem[];
  recovering: DiscoverItem[];
  bullish: DiscoverItem[];
  bearish: DiscoverItem[];
  errors: string[];
  generatedAt: number;
}

const riskFromLiquidity = (liq: number | null, mcap: number | null): { risk: DiscoverItem["risk"]; riskNote: string } => {
  if (liq != null && liq < 25_000) return { risk: "extreme", riskNote: `Liquidity only $${fmtK(liq)} - slippage and rug risk are severe.` };
  if ((liq != null && liq < 150_000) || (mcap != null && mcap < 1_000_000)) return { risk: "high", riskNote: "Micro-cap / thin liquidity - speculative only." };
  if ((liq != null && liq < 1_000_000) || (mcap != null && mcap < 50_000_000)) return { risk: "medium", riskNote: "Small-cap - volatile." };
  return { risk: "low", riskNote: "Established market." };
};

export async function discover(): Promise<DiscoverResult> {
  const errors: string[] = [];
  const [tickersR, topR, trendR, gtTrendR, gtNewR] = await Promise.all([
    safe(binance.getAllUsdtTickers()),
    safe(cg.getMarkets(1, 250, false)),
    safe(cg.getTrending()),
    safe(gt.getTrendingPools()),
    safe(gt.getNewPools()),
  ]);
  if (!tickersR.ok) errors.push("Binance tickers: " + tickersR.error);
  if (!topR.ok) errors.push("CoinGecko markets: " + topR.error);
  if (!trendR.ok) errors.push("CoinGecko trending: " + trendR.error);
  if (!gtTrendR.ok) errors.push("GeckoTerminal trending: " + gtTrendR.error);
  if (!gtNewR.ok) errors.push("GeckoTerminal new pools: " + gtNewR.error);

  const top = topR.ok ? topR.data : [];
  const bySym = new Map(top.map((c) => [c.symbol, c]));
  const tickers = (tickersR.ok ? tickersR.data : []).filter((t) => t.quoteVolume > 2_000_000); // ignore dust pairs

  const toItem = (t: binance.Ticker24h, metric: string): DiscoverItem => {
    const sym = t.symbol.replace("USDT", "");
    const c = bySym.get(sym);
    const r = riskFromLiquidity(null, c?.marketCapUsd ?? null);
    return { symbol: sym, name: c?.name, id: c?.id, priceUsd: t.lastPrice, change24hPct: t.priceChangePercent, volume24hUsd: t.quoteVolume, marketCapUsd: c?.marketCapUsd ?? null, metric, source: "binance", ...r };
  };

  const gainers = [...tickers].sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 12).map((t) => toItem(t, `+${t.priceChangePercent.toFixed(1)}% in 24h`));
  const losers = [...tickers].sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 12).map((t) => toItem(t, `${t.priceChangePercent.toFixed(1)}% in 24h`));

  // unusual volume: 24h quote volume vs market cap (turnover) for coins we know the cap of
  const unusualVolume = tickers
    .map((t) => {
      const c = bySym.get(t.symbol.replace("USDT", ""));
      const turnover = c?.marketCapUsd ? t.quoteVolume / c.marketCapUsd : null;
      return { t, turnover };
    })
    .filter((x) => x.turnover != null && x.turnover > 0.15)
    .sort((a, b) => b.turnover! - a.turnover!)
    .slice(0, 12)
    .map((x) => toItem(x.t, `${(x.turnover! * 100).toFixed(0)}% of market cap traded in 24h`));

  // recovery candidates: down >30% from ATH, but up >8% in 24h
  const recovering = top
    .filter((c) => c.athChangePct != null && c.athChangePct < -30 && (c.change24hPct ?? 0) > 8)
    .slice(0, 12)
    .map<DiscoverItem>((c) => ({ symbol: c.symbol, name: c.name, id: c.id, priceUsd: c.priceUsd, change24hPct: c.change24hPct, volume24hUsd: c.volume24hUsd, marketCapUsd: c.marketCapUsd, metric: `${c.athChangePct!.toFixed(0)}% from ATH, +${c.change24hPct!.toFixed(1)}% today`, source: "coingecko", ...riskFromLiquidity(null, c.marketCapUsd) }));

  const trending = (trendR.ok ? trendR.data : []).map<DiscoverItem>((c) => ({ symbol: c.symbol, name: c.name, id: c.id, priceUsd: c.priceUsd, change24hPct: c.change24hPct, volume24hUsd: null, metric: "Trending on CoinGecko", source: "coingecko", ...riskFromLiquidity(null, bySym.get(c.symbol)?.marketCapUsd ?? null) }));

  const poolItem = (p: gt.GtTrendingPool, metric: string): DiscoverItem => ({
    symbol: p.name.split("/")[0].trim(),
    name: p.name,
    priceUsd: p.priceUsd,
    change24hPct: p.change24h,
    volume24hUsd: p.volume24h,
    liquidityUsd: p.liquidityUsd,
    marketCapUsd: p.fdv,
    chain: p.network,
    address: p.baseTokenAddress ?? undefined,
    pool: { network: p.network, address: p.poolAddress },
    metric,
    source: "geckoterminal",
    ...riskFromLiquidity(p.liquidityUsd, p.fdv),
  });
  const dexTrending = (gtTrendR.ok ? gtTrendR.data : []).slice(0, 20).map((p) => poolItem(p, "Trending DEX pool"));
  const newPools = (gtNewR.ok ? gtNewR.data : []).slice(0, 20).map((p) => poolItem(p, p.createdAt ? `Created ${timeAgo(p.createdAt)}` : "New pool"));

  // bullish/bearish picks: run 4h analysis on top-40 by market cap that are on Binance
  const candidates = top.slice(0, 40).filter((c) => tickers.some((t) => t.symbol === `${c.symbol}USDT`));
  const analyzed = await Promise.all(
    candidates.slice(0, 30).map(async (c) => {
      const r = await safe(binance.getKlines(`${c.symbol}USDT`, "4h", 300));
      if (!r.ok) return null;
      const a = analyzeTimeframe("4h", r.data);
      if (!a) return null;
      return { c, a };
    }),
  );
  const scored = analyzed.filter((x): x is NonNullable<typeof x> => !!x);
  const pick = (x: NonNullable<(typeof scored)[number]>): DiscoverItem => ({ symbol: x.c.symbol, name: x.c.name, id: x.c.id, priceUsd: x.a.price, change24hPct: x.c.change24hPct, volume24hUsd: x.c.volume24hUsd, marketCapUsd: x.c.marketCapUsd, metric: `4h score ${x.a.score > 0 ? "+" : ""}${x.a.score} · ${x.a.outlook}${x.a.setup ? ` · ${x.a.setup.kind} ${x.a.setup.side}` : ""}`, score: x.a.score, source: "binance", ...riskFromLiquidity(null, x.c.marketCapUsd) });
  const bullish = scored.filter((x) => x.a.score >= 15).sort((a, b) => b.a.score - a.a.score).slice(0, 8).map(pick);
  const bearish = scored.filter((x) => x.a.score <= -15).sort((a, b) => a.a.score - b.a.score).slice(0, 8).map(pick);

  return { trending, dexTrending, newPools, unusualVolume, gainers, losers, recovering, bullish, bearish, errors, generatedAt: Date.now() };
}

function fmtK(v: number) {
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
}
function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
