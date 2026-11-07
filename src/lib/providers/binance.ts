// Binance public market data (no API key required for these endpoints).
// Provides the highest-quality OHLCV for CEX-listed coins across all timeframes.

import { fetchJson } from "@/lib/fetch";
import type { Candle, Timeframe } from "@/lib/types";

const BASE = "https://api.binance.com/api/v3";
const opts = (ttl: number) => ({ provider: "binance", ttl });

let symbolSet: Set<string> | null = null;
let symbolSetAt = 0;

/** Set of all currently TRADING spot symbols, e.g. "BTCUSDT". Cached 1h. */
export async function getTradingSymbols(): Promise<Set<string>> {
  if (symbolSet && Date.now() - symbolSetAt < 3_600_000) return symbolSet;
  const r = await fetchJson<{ symbols: { symbol: string; status: string; quoteAsset: string }[] }>(
    `${BASE}/exchangeInfo?permissions=SPOT`,
    opts(3_600_000),
  );
  symbolSet = new Set(r.symbols.filter((s) => s.status === "TRADING").map((s) => s.symbol));
  symbolSetAt = Date.now();
  return symbolSet;
}

const QUOTES = ["USDT", "FDUSD", "USDC", "BTC"];

/** Find the best Binance spot pair for a ticker symbol like "SOL". Returns null if none. */
export async function resolveSymbol(ticker: string): Promise<string | null> {
  const set = await getTradingSymbols();
  const t = ticker.toUpperCase();
  for (const q of QUOTES) {
    if (set.has(`${t}${q}`)) return `${t}${q}`;
  }
  return null;
}

export async function getKlines(symbol: string, tf: Timeframe, limit = 500): Promise<Candle[]> {
  const interval = tf; // Binance uses the same codes: 1m 5m 15m 30m 1h 4h 12h 1d 1w 1M
  const ttl = tf === "1m" ? 10_000 : tf === "5m" ? 20_000 : tf === "15m" || tf === "30m" ? 30_000 : 60_000;
  const r = await fetchJson<(string | number)[][]>(
    `${BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`,
    opts(ttl),
  );
  return r.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
  count: number;
}

export async function getTicker24h(symbol: string): Promise<Ticker24h> {
  const r = await fetchJson<Record<string, string>>(`${BASE}/ticker/24hr?symbol=${symbol}`, opts(15_000));
  return {
    symbol: r.symbol,
    lastPrice: Number(r.lastPrice),
    priceChangePercent: Number(r.priceChangePercent),
    quoteVolume: Number(r.quoteVolume),
    volume: Number(r.volume),
    highPrice: Number(r.highPrice),
    lowPrice: Number(r.lowPrice),
    count: Number(r.count),
  };
}

/** All USDT tickers at once — used for "unusual volume" and gainers/losers scans. */
export async function getAllUsdtTickers(): Promise<Ticker24h[]> {
  const r = await fetchJson<Record<string, string>[]>(`${BASE}/ticker/24hr`, opts(30_000));
  return r
    .filter((t) => t.symbol.endsWith("USDT") && !/UP|DOWN|BULL|BEAR/.test(t.symbol.replace("USDT", "")))
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice),
      priceChangePercent: Number(t.priceChangePercent),
      quoteVolume: Number(t.quoteVolume),
      volume: Number(t.volume),
      highPrice: Number(t.highPrice),
      lowPrice: Number(t.lowPrice),
      count: Number(t.count),
    }));
}
