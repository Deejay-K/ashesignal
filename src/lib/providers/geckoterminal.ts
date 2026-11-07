// GeckoTerminal: OHLCV for DEX pools (the only free source of real candles for
// tokens that are not on a CEX). 30 req/min, no key.

import { fetchJson } from "@/lib/fetch";
import type { Candle, Timeframe } from "@/lib/types";

const BASE = "https://api.geckoterminal.com/api/v2";
const opts = (ttl: number) => ({ provider: "geckoterminal", ttl, headers: { accept: "application/json;version=20230302" } });

/** GeckoTerminal only offers minute/hour/day with aggregate multipliers. */
const TF_MAP: Partial<Record<Timeframe, { tf: "minute" | "hour" | "day"; agg: number }>> = {
  "1m": { tf: "minute", agg: 1 },
  "5m": { tf: "minute", agg: 5 },
  "15m": { tf: "minute", agg: 15 },
  "30m": { tf: "minute", agg: 15 }, // resampled client-side
  "1h": { tf: "hour", agg: 1 },
  "4h": { tf: "hour", agg: 4 },
  "12h": { tf: "hour", agg: 12 },
  "1d": { tf: "day", agg: 1 },
  "1w": { tf: "day", agg: 1 }, // resampled
  "1M": { tf: "day", agg: 1 }, // resampled
};

export function supportsTimeframe(tf: Timeframe) {
  return tf in TF_MAP;
}

export async function getPoolOhlcv(network: string, poolAddress: string, tf: Timeframe, limit = 500): Promise<Candle[]> {
  const m = TF_MAP[tf];
  if (!m) return [];
  const url = `${BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${m.tf}?aggregate=${m.agg}&limit=${Math.min(limit, 1000)}&currency=usd`;
  const r = await fetchJson<{ data: { attributes: { ohlcv_list: number[][] } } }>(url, opts(60_000));
  const list = r.data?.attributes?.ohlcv_list ?? [];
  return list
    .map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .sort((a, b) => a.time - b.time);
}

export interface GtTrendingPool {
  network: string;
  poolAddress: string;
  name: string;
  baseTokenAddress: string | null;
  priceUsd: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  change24h: number | null;
  change1h: number | null;
  createdAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPool(p: any): GtTrendingPool {
  const a = p.attributes ?? {};
  const num = (v: unknown) => (v == null ? null : Number(v));
  const baseId: string | undefined = p.relationships?.base_token?.data?.id;
  return {
    network: p.id?.split("_")?.[0] ?? "",
    poolAddress: a.address,
    name: a.name,
    baseTokenAddress: baseId ? baseId.split("_").slice(1).join("_") : null,
    priceUsd: num(a.base_token_price_usd),
    volume24h: num(a.volume_usd?.h24),
    liquidityUsd: num(a.reserve_in_usd),
    fdv: num(a.fdv_usd),
    change24h: num(a.price_change_percentage?.h24),
    change1h: num(a.price_change_percentage?.h1),
    createdAt: a.pool_created_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getTrendingPools(network?: string): Promise<GtTrendingPool[]> {
  const url = network ? `${BASE}/networks/${network}/trending_pools?page=1` : `${BASE}/networks/trending_pools?page=1`;
  const r = await fetchJson<{ data: unknown[] }>(url, opts(120_000));
  return (r.data ?? []).map(toPool);
}

export async function getNewPools(network?: string): Promise<GtTrendingPool[]> {
  const url = network ? `${BASE}/networks/${network}/new_pools?page=1` : `${BASE}/networks/new_pools?page=1`;
  const r = await fetchJson<{ data: unknown[] }>(url, opts(120_000));
  return (r.data ?? []).map(toPool);
}
