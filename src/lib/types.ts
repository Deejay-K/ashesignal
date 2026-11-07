// Core shared types for AsheSignal.

export type Timeframe =
  | "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "12h" | "1d" | "1w" | "1M";

export const TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "1w", "1M",
];

/** Milliseconds per candle for each timeframe. */
export const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
};

export interface Candle {
  time: number; // unix seconds (lightweight-charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Every number the app shows is tagged with how trustworthy it is.
 *  - verified: straight from an exchange or on-chain indexer
 *  - estimated: derived/aggregated (e.g. DEX price averaged across pools)
 *  - unavailable: we could not get it
 */
export type DataQuality = "verified" | "estimated" | "unavailable";

export interface Sourced<T> {
  value: T | null;
  quality: DataQuality;
  source: string; // e.g. "binance", "coingecko", "dexscreener"
  fetchedAt: number; // ms epoch
  note?: string;
}

export interface MarketOverview {
  totalMarketCapUsd: Sourced<number>;
  totalVolume24hUsd: Sourced<number>;
  btcDominance: Sourced<number>;
  ethDominance: Sourced<number>;
  marketCapChange24hPct: Sourced<number>;
  activeCoins: Sourced<number>;
}

export interface CoinRow {
  id: string; // coingecko id
  symbol: string;
  name: string;
  image?: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  rank: number | null;
  volume24hUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  sparkline7d?: number[];
  ath?: number | null;
  athChangePct?: number | null;
  source: string;
}

export interface FearGreedPoint {
  value: number; // 0-100
  label: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";
  timestamp: number; // unix seconds
}

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url?: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: number | null;
  priceNative: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  volume: { h24: number | null; h6: number | null; h1: number | null; m5: number | null };
  priceChange: { h24: number | null; h6: number | null; h1: number | null; m5: number | null };
  txns: {
    h24: { buys: number; sells: number };
    h1: { buys: number; sells: number };
  };
  pairCreatedAt: number | null; // ms epoch
  info?: { imageUrl?: string; websites?: string[]; socials?: { type: string; url: string }[] };
  boosts?: number;
}

export interface OhlcvResult {
  candles: Candle[];
  source: string;
  symbol: string; // what we actually charted, e.g. "BTCUSDT" or a pool address
  quality: DataQuality;
  note?: string;
}

/** A chain the scanner understands. */
export interface ChainInfo {
  id: string; // internal id, also DexScreener chainId
  name: string;
  family: "evm" | "solana" | "other";
  goplusChainId?: string; // GoPlus token-security chain id (EVM only)
  explorer?: string; // base URL for token pages
}
