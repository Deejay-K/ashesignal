// Opportunity discovery: scans Binance USDT tickers for unusual volume / gainers
// / losers / recovery candidates, pulls CoinGecko trending and DEX trending/new
// pools, and runs the 4h analysis on the strongest candidates for bull/bear picks.

import { venueOrder, VENUE_META, type VenueId, type BulkTicker } from "@/lib/venues";
import * as cg from "@/lib/providers/coingecko";
import * as gt from "@/lib/providers/geckoterminal";
import { safe } from "@/lib/fetch";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { isRealCoin, MIN_LIST_CAP, MAX_SANE_TURNOVER } from "./junk";

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
  venue: VenueId;
  trending: DiscoverItem[];
  dexTrending: DiscoverItem[];
  newPools: DiscoverItem[];
  unusualVolume: DiscoverItem[];
  gainers: DiscoverItem[];
  losers: DiscoverItem[];
  recovering: DiscoverItem[];
  bullish: DiscoverItem[];
  bearish: DiscoverItem[];
  /** How the analysed top coins split on 4h, so an empty bullish or bearish list can say why. */
  breadth: { analyzed: number; bullish: number; bearish: number; neutral: number };
  errors: string[];
  generatedAt: number;
}

const riskFromLiquidity = (liq: number | null, mcap: number | null): { risk: DiscoverItem["risk"]; riskNote: string } => {
  if (liq == null && mcap == null) return { risk: "high", riskNote: "Outside the top 250 by market cap: small, volatile and easy to move." };
  if (liq != null && liq < 25_000) return { risk: "extreme", riskNote: `Liquidity only $${fmtK(liq)} - slippage and rug risk are severe.` };
  if ((liq != null && liq < 150_000) || (mcap != null && mcap < 1_000_000)) return { risk: "high", riskNote: "Micro-cap / thin liquidity - speculative only." };
  if ((liq != null && liq < 1_000_000) || (mcap != null && mcap < 50_000_000)) return { risk: "medium", riskNote: "Small-cap - volatile." };
  return { risk: "low", riskNote: "Established market." };
};

export async function discover(activeVenue?: VenueId | null): Promise<DiscoverResult> {
  const errors: string[] = [];
  // Gainers/losers/unusual volume and the bullish/bearish picks run on the active exchange; venues without a
  // bulk ticker endpoint (Coinbase) fall back to the next one that has it.
  const order = venueOrder(activeVenue);
  const venue = order.find((v) => v.allTickers) ?? order[0];
  const venueId = venue.name as VenueId;
  const [tickersR, topR, trendR, gtTrendR, gtNewR] = await Promise.all([
    safe(venue.allTickers ? venue.allTickers() : Promise.resolve([] as BulkTicker[])),
    safe(cg.getMarkets(1, 250, false)),
    safe(cg.getTrending()),
    safe(gt.getTrendingPools()),
    safe(gt.getNewPools()),
  ]);
  if (!tickersR.ok) errors.push(`${VENUE_META[venueId].label} tickers: ` + tickersR.error);
  if (!topR.ok) errors.push("CoinGecko markets: " + topR.error);
  if (!trendR.ok) errors.push("CoinGecko trending: " + trendR.error);
  if (!gtTrendR.ok) errors.push("GeckoTerminal trending: " + gtTrendR.error);
  if (!gtNewR.ok) errors.push("GeckoTerminal new pools: " + gtNewR.error);

  const top = topR.ok ? topR.data : [];
  const bySym = new Map(top.map((c) => [c.symbol, c]));
  const tickers = (tickersR.ok ? tickersR.data : []).filter((t) => t.volumeQuote24h > 2_000_000 && !/UP$|DOWN$|BULL$|BEAR$|^[0-9]+[LS]$/.test(t.base)); // ignore dust and leveraged tokens

  const toItem = (t: BulkTicker, metric: string): DiscoverItem => {
    const c = bySym.get(t.base);
    const r = riskFromLiquidity(null, c?.marketCapUsd ?? null);
    return { symbol: t.base, name: c?.name, id: c?.id, priceUsd: t.last, change24hPct: t.change24hPct, volume24hUsd: t.volumeQuote24h, marketCapUsd: c?.marketCapUsd ?? null, metric, source: venueId, ...r };
  };

  // Movers lists only show real coins with a known, meaningful market cap: no stablecoins, wrapped copies or
  // tokenized stocks, and no micro-caps where a 300% day is one buyer.
  const listable = tickers.filter((t) => { const c = bySym.get(t.base); return !!c && isRealCoin(c) && (c.marketCapUsd ?? 0) >= MIN_LIST_CAP; });
  const gainers = [...listable].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 12).map((t) => toItem(t, `+${t.change24hPct.toFixed(1)}% in 24h`));
  const losers = [...listable].sort((a, b) => a.change24hPct - b.change24hPct).slice(0, 12).map((t) => toItem(t, `${t.change24hPct.toFixed(1)}% in 24h`));

  // unusual volume: 24h quote volume vs market cap (turnover) for coins we know the cap of
  const unusualVolume = listable
    .map((t) => {
      const c = bySym.get(t.base);
      const turnover = c?.marketCapUsd ? t.volumeQuote24h / c.marketCapUsd : null;
      return { t, turnover };
    })
    .filter((x) => x.turnover != null && x.turnover > 0.15 && x.turnover <= MAX_SANE_TURNOVER)
    .sort((a, b) => b.turnover! - a.turnover!)
    .slice(0, 12)
    .map((x) => toItem(x.t, `${(x.turnover! * 100).toFixed(0)}% of market cap traded in 24h`));

  // recovery candidates: down >30% from ATH, but up >8% in 24h
  const recovering = top
    .filter((c) => isRealCoin(c) && c.athChangePct != null && c.athChangePct < -30 && (c.change24hPct ?? 0) > 8)
    .slice(0, 12)
    .map<DiscoverItem>((c) => ({ symbol: c.symbol, name: c.name, id: c.id, priceUsd: c.priceUsd, change24hPct: c.change24hPct, volume24hUsd: c.volume24hUsd, marketCapUsd: c.marketCapUsd, metric: `${c.athChangePct!.toFixed(0)}% from ATH, +${c.change24hPct!.toFixed(1)}% today`, source: "coingecko", ...riskFromLiquidity(null, c.marketCapUsd) }));

  const trending = (trendR.ok ? trendR.data : []).filter((c) => isRealCoin(c)).map<DiscoverItem>((c) => ({ symbol: c.symbol, name: c.name, id: c.id, priceUsd: c.priceUsd, change24hPct: c.change24hPct, volume24hUsd: null, metric: "Trending on CoinGecko", source: "coingecko", ...riskFromLiquidity(null, bySym.get(c.symbol)?.marketCapUsd ?? null) }));

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

  // bullish/bearish picks: run 4h analysis on the top-40 by market cap that trade on the active exchange
  const listed = new Map(tickers.map((t) => [t.base, t.instrument]));
  const candidates = top.filter((c) => isRealCoin(c)).slice(0, 40).filter((c) => listed.has(c.symbol));
  const analyzed = await Promise.all(
    candidates.slice(0, 30).map(async (c) => {
      const r = await safe(venue.klines(listed.get(c.symbol)!, "4h", 300));
      if (!r.ok) return null;
      const a = analyzeTimeframe("4h", r.data);
      if (!a) return null;
      return { c, a };
    }),
  );
  const scored = analyzed.filter((x): x is NonNullable<typeof x> => !!x);
  const pick = (x: NonNullable<(typeof scored)[number]>): DiscoverItem => ({ symbol: x.c.symbol, name: x.c.name, id: x.c.id, priceUsd: x.a.price, change24hPct: x.c.change24hPct, volume24hUsd: x.c.volume24hUsd, marketCapUsd: x.c.marketCapUsd, metric: `4h score ${x.a.score > 0 ? "+" : ""}${x.a.score} · ${x.a.outlook}${x.a.setup ? ` · ${x.a.setup.kind} ${x.a.setup.side}` : ""}`, score: x.a.score, source: venueId, ...riskFromLiquidity(null, x.c.marketCapUsd) });
  const bullish = scored.filter((x) => x.a.score >= 15).sort((a, b) => b.a.score - a.a.score).slice(0, 8).map(pick);
  const bearish = scored.filter((x) => x.a.score <= -15).sort((a, b) => a.a.score - b.a.score).slice(0, 8).map(pick);

  const breadth = { analyzed: scored.length, bullish: scored.filter((x) => x.a.score >= 15).length, bearish: scored.filter((x) => x.a.score <= -15).length, neutral: scored.filter((x) => Math.abs(x.a.score) < 15).length };
  return { venue: venueId, trending, dexTrending, newPools, unusualVolume, gainers, losers, recovering, bullish, bearish, breadth, errors, generatedAt: Date.now() };
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
