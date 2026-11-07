// DexScreener: DEX pairs by token address / search, boosted & new tokens.
// Free, no key. Covers Ethereum, Solana, BSC, Base, Polygon, Arbitrum, Avalanche, etc.

import { fetchJson } from "@/lib/fetch";
import type { DexPair } from "@/lib/types";

const BASE = "https://api.dexscreener.com";
const opts = (ttl: number) => ({ provider: "dexscreener", ttl });

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPair(p: any): DexPair {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    chainId: p.chainId,
    dexId: p.dexId,
    pairAddress: p.pairAddress,
    url: p.url,
    baseToken: p.baseToken,
    quoteToken: p.quoteToken,
    priceUsd: num(p.priceUsd),
    priceNative: num(p.priceNative),
    liquidityUsd: num(p.liquidity?.usd),
    fdv: num(p.fdv),
    marketCap: num(p.marketCap),
    volume: { h24: num(p.volume?.h24), h6: num(p.volume?.h6), h1: num(p.volume?.h1), m5: num(p.volume?.m5) },
    priceChange: { h24: num(p.priceChange?.h24), h6: num(p.priceChange?.h6), h1: num(p.priceChange?.h1), m5: num(p.priceChange?.m5) },
    txns: {
      h24: { buys: p.txns?.h24?.buys ?? 0, sells: p.txns?.h24?.sells ?? 0 },
      h1: { buys: p.txns?.h1?.buys ?? 0, sells: p.txns?.h1?.sells ?? 0 },
    },
    pairCreatedAt: p.pairCreatedAt ?? null,
    info: p.info,
    boosts: p.boosts?.active,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** All pairs for a token address - chain is auto-detected by DexScreener. */
export async function getPairsByToken(address: string): Promise<DexPair[]> {
  const r = await fetchJson<{ pairs: unknown[] | null }>(`${BASE}/latest/dex/tokens/${address}`, opts(20_000));
  return (r.pairs ?? []).map(toPair).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

export async function searchPairs(q: string): Promise<DexPair[]> {
  const r = await fetchJson<{ pairs: unknown[] | null }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`, opts(30_000));
  return (r.pairs ?? []).map(toPair);
}

export async function getPair(chainId: string, pairAddress: string): Promise<DexPair | null> {
  const r = await fetchJson<{ pairs: unknown[] | null }>(`${BASE}/latest/dex/pairs/${chainId}/${pairAddress}`, opts(20_000));
  const p = r.pairs?.[0];
  return p ? toPair(p) : null;
}

export interface TokenProfile {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  description?: string;
  url?: string;
  amount?: number; // boost amount
}

/** Latest token profiles - a proxy for "newly promoted / emerging tokens". 60 req/min. */
export async function getLatestProfiles(): Promise<TokenProfile[]> {
  return fetchJson<TokenProfile[]>(`${BASE}/token-profiles/latest/v1`, opts(60_000));
}

/** Tokens with most active boosts - a proxy for "trending on DEXs". 60 req/min. */
export async function getTopBoosted(): Promise<TokenProfile[]> {
  return fetchJson<TokenProfile[]>(`${BASE}/token-boosts/top/v1`, opts(60_000));
}

/** Batch pairs for up to 30 token addresses on one chain. */
export async function getPairsForTokens(chainId: string, addresses: string[]): Promise<DexPair[]> {
  const out: DexPair[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const r = await fetchJson<unknown[]>(`${BASE}/tokens/v1/${chainId}/${chunk.join(",")}`, opts(30_000));
    out.push(...(Array.isArray(r) ? r.map(toPair) : []));
  }
  return out;
}
