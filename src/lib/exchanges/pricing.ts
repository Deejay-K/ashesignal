// Historical USD pricing for crypto-quoted trades (ETH/BTC etc.). Daily closes from CoinGecko,
// cached per (asset, day). Converts fill price and fee into USD so FIFO can include them.

import { fetchJson, safe } from "@/lib/fetch";
import type { ExchangeFill } from "./types";
import { STABLES } from "./types";

const QUOTE_IDS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", MATIC: "matic-network", POL: "polygon-ecosystem-token", AVAX: "avalanche-2", DOT: "polkadot", LTC: "litecoin", LINK: "chainlink", ATOM: "cosmos", TRX: "tron" };
const CG_BASE = process.env.COINGECKO_PRO_API_KEY ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const CG_HEADERS: Record<string, string> = process.env.COINGECKO_PRO_API_KEY ? { "x-cg-pro-api-key": process.env.COINGECKO_PRO_API_KEY } : process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};

const dayCache = new Map<string, Map<string, number>>(); // asset -> (YYYY-MM-DD -> usd)

async function dailyUsd(asset: string, from: number, to: number): Promise<Map<string, number>> {
  const id = QUOTE_IDS[asset];
  if (!id) return new Map();
  const key = asset;
  const cache = dayCache.get(key) ?? new Map<string, number>();
  const r = await safe(fetchJson<{ prices: [number, number][] }>(`${CG_BASE}/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(from / 1000) - 86400}&to=${Math.floor(to / 1000) + 86400}`, { provider: "coingecko", headers: CG_HEADERS, ttl: 3_600_000 }));
  if (r.ok) for (const [t, p] of r.data.prices) cache.set(new Date(t).toISOString().slice(0, 10), p);
  dayCache.set(key, cache);
  return cache;
}

/** Returns fills with crypto quotes converted to USD-equivalent (quote "USD*"), plus the list that could not be priced. */
export async function priceFillsInUsd(fills: ExchangeFill[]): Promise<{ fills: ExchangeFill[]; unpriced: string[] }> {
  const byQuote = new Map<string, ExchangeFill[]>();
  for (const f of fills) if (!STABLES.has(f.quote)) byQuote.set(f.quote, [...(byQuote.get(f.quote) ?? []), f]);
  const out: ExchangeFill[] = fills.filter((f) => STABLES.has(f.quote));
  const unpriced = new Set<string>();
  for (const [quote, fs] of byQuote) {
    const times = fs.map((f) => Date.parse(f.time)).filter(Number.isFinite);
    const table = times.length ? await dailyUsd(quote, Math.min(...times), Math.max(...times)) : new Map<string, number>();
    for (const f of fs) {
      const day = f.time.slice(0, 10);
      const rate = table.get(day) ?? nearest(table, day);
      if (!rate) { unpriced.add(quote); continue; }
      out.push({ ...f, quote: "USD*", price: f.price * rate, fee: f.feeAsset === quote ? f.fee * rate : f.fee, feeAsset: "USD*" });
    }
  }
  return { fills: out, unpriced: [...unpriced] };
}

function nearest(table: Map<string, number>, day: string): number | undefined {
  let best: [string, number] | null = null;
  const t = Date.parse(day);
  for (const [d, v] of table) { const dt = Math.abs(Date.parse(d) - t); if (dt <= 3 * 86_400_000 && (!best || dt < Math.abs(Date.parse(best[0]) - t))) best = [d, v]; }
  return best?.[1];
}
