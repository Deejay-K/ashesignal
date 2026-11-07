// CoinGecko: market overview, top coins, trending, search, coin metadata.
// Works without a key (rate-limited); set COINGECKO_API_KEY for the demo
// tier (header x-cg-demo-api-key) or COINGECKO_PRO_API_KEY for pro.

import { fetchJson } from "@/lib/fetch";
import type { CoinRow, MarketOverview, Sourced } from "@/lib/types";

const PRO = process.env.COINGECKO_PRO_API_KEY;
const DEMO = process.env.COINGECKO_API_KEY;
const BASE = PRO ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const HEADERS: Record<string, string> = PRO
  ? { "x-cg-pro-api-key": PRO }
  : DEMO
    ? { "x-cg-demo-api-key": DEMO }
    : {};

const opts = (ttl: number) => ({ provider: "coingecko", headers: HEADERS, ttl });

function s<T>(value: T | null | undefined, note?: string): Sourced<T> {
  return {
    value: value ?? null,
    quality: value == null ? "unavailable" : "verified",
    source: "coingecko",
    fetchedAt: Date.now(),
    note,
  };
}

export async function getGlobal(): Promise<MarketOverview> {
  const r = await fetchJson<{
    data: {
      total_market_cap: Record<string, number>;
      total_volume: Record<string, number>;
      market_cap_percentage: Record<string, number>;
      market_cap_change_percentage_24h_usd: number;
      active_cryptocurrencies: number;
    };
  }>(`${BASE}/global`, opts(60_000));
  const d = r.data;
  return {
    totalMarketCapUsd: s(d.total_market_cap?.usd),
    totalVolume24hUsd: s(d.total_volume?.usd),
    btcDominance: s(d.market_cap_percentage?.btc),
    ethDominance: s(d.market_cap_percentage?.eth),
    marketCapChange24hPct: s(d.market_cap_change_percentage_24h_usd),
    activeCoins: s(d.active_cryptocurrencies),
  };
}

interface CgMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_24h?: number | null;
  sparkline_in_7d?: { price: number[] };
  ath?: number | null;
  ath_change_percentage?: number | null;
}

function toRow(m: CgMarket): CoinRow {
  return {
    id: m.id,
    symbol: m.symbol.toUpperCase(),
    name: m.name,
    image: m.image,
    priceUsd: m.current_price,
    marketCapUsd: m.market_cap,
    rank: m.market_cap_rank,
    volume24hUsd: m.total_volume,
    change1hPct: m.price_change_percentage_1h_in_currency ?? null,
    change24hPct: m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h ?? null,
    change7dPct: m.price_change_percentage_7d_in_currency ?? null,
    sparkline7d: m.sparkline_in_7d?.price,
    ath: m.ath ?? null,
    athChangePct: m.ath_change_percentage ?? null,
    source: "coingecko",
  };
}

export async function getMarkets(page = 1, perPage = 100, sparkline = true): Promise<CoinRow[]> {
  const url =
    `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}` +
    `&sparkline=${sparkline}&price_change_percentage=1h,24h,7d`;
  const r = await fetchJson<CgMarket[]>(url, opts(60_000));
  return r.map(toRow);
}

export async function getMarketsByIds(ids: string[]): Promise<CoinRow[]> {
  if (!ids.length) return [];
  const url =
    `${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}` +
    `&sparkline=true&price_change_percentage=1h,24h,7d`;
  const r = await fetchJson<CgMarket[]>(url, opts(60_000));
  return r.map(toRow);
}

export async function getTrending(): Promise<
  { id: string; symbol: string; name: string; image?: string; rank: number | null; priceUsd: number | null; change24hPct: number | null }[]
> {
  const r = await fetchJson<{
    coins: { item: { id: string; symbol: string; name: string; small?: string; market_cap_rank: number | null; data?: { price?: number; price_change_percentage_24h?: { usd?: number } } } }[];
  }>(`${BASE}/search/trending`, opts(120_000));
  return r.coins.map(({ item }) => ({
    id: item.id,
    symbol: item.symbol.toUpperCase(),
    name: item.name,
    image: item.small,
    rank: item.market_cap_rank,
    priceUsd: item.data?.price ?? null,
    change24hPct: item.data?.price_change_percentage_24h?.usd ?? null,
  }));
}

export async function search(q: string) {
  const r = await fetchJson<{ coins: { id: string; name: string; symbol: string; market_cap_rank: number | null; thumb?: string }[] }>(
    `${BASE}/search?query=${encodeURIComponent(q)}`,
    opts(300_000),
  );
  return r.coins.slice(0, 20).map((c) => ({ ...c, symbol: c.symbol.toUpperCase() }));
}

export interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  description?: string;
  categories: string[];
  platforms: Record<string, string>; // chain -> contract address
  marketCapRank: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  ath: number | null;
  athDate: string | null;
  atl: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  change1yPct: number | null;
  sentimentUpPct: number | null;
  homepage?: string;
  tickers: { exchange: string; base: string; target: string; lastUsd: number | null; volumeUsd: number | null; trustScore: string | null }[];
}

export async function getCoin(id: string): Promise<CoinDetail> {
  const r = await fetchJson<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    `${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false&sparkline=false`,
    opts(120_000),
  );
  const md = r.market_data ?? {};
  return {
    id: r.id,
    symbol: String(r.symbol).toUpperCase(),
    name: r.name,
    image: r.image?.large ?? r.image?.small,
    description: r.description?.en,
    categories: r.categories ?? [],
    platforms: r.platforms ?? {},
    marketCapRank: r.market_cap_rank ?? null,
    priceUsd: md.current_price?.usd ?? null,
    marketCapUsd: md.market_cap?.usd ?? null,
    fdvUsd: md.fully_diluted_valuation?.usd ?? null,
    volume24hUsd: md.total_volume?.usd ?? null,
    circulatingSupply: md.circulating_supply ?? null,
    totalSupply: md.total_supply ?? null,
    maxSupply: md.max_supply ?? null,
    ath: md.ath?.usd ?? null,
    athDate: md.ath_date?.usd ?? null,
    atl: md.atl?.usd ?? null,
    change24hPct: md.price_change_percentage_24h ?? null,
    change7dPct: md.price_change_percentage_7d ?? null,
    change30dPct: md.price_change_percentage_30d ?? null,
    change1yPct: md.price_change_percentage_1y ?? null,
    sentimentUpPct: r.sentiment_votes_up_percentage ?? null,
    homepage: r.links?.homepage?.[0] || undefined,
    tickers: (r.tickers ?? []).slice(0, 40).map((t: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      exchange: t.market?.name ?? "?",
      base: t.base,
      target: t.target,
      lastUsd: t.converted_last?.usd ?? null,
      volumeUsd: t.converted_volume?.usd ?? null,
      trustScore: t.trust_score ?? null,
    })),
  };
}

/** Daily close history from CoinGecko — fallback OHLCV source for coins with no Binance pair. */
export async function getMarketChart(id: string, days: number) {
  const r = await fetchJson<{ prices: [number, number][]; total_volumes: [number, number][] }>(
    `${BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
    opts(300_000),
  );
  return r;
}

/** CoinGecko OHLC endpoint (4h candles for ≤30 days, daily beyond). No volume. */
export async function getOhlc(id: string, days: 1 | 7 | 14 | 30 | 90 | 180 | 365) {
  return fetchJson<[number, number, number, number, number][]>(
    `${BASE}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`,
    opts(300_000),
  );
}
