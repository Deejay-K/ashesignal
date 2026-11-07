// Alchemy: EVM wallet balances, token metadata and transfers. Free tier: 300M CU/month.
// One key works for every supported network. https://dashboard.alchemy.com

import { fetchJson } from "@/lib/fetch";

export const ALCHEMY_NETWORKS: Record<string, { sub: string; native: { symbol: string; coingeckoId: string; decimals: number }; cgPlatform: string }> = {
  ethereum: { sub: "eth-mainnet", native: { symbol: "ETH", coingeckoId: "ethereum", decimals: 18 }, cgPlatform: "ethereum" },
  base: { sub: "base-mainnet", native: { symbol: "ETH", coingeckoId: "ethereum", decimals: 18 }, cgPlatform: "base" },
  polygon: { sub: "polygon-mainnet", native: { symbol: "POL", coingeckoId: "polygon-ecosystem-token", decimals: 18 }, cgPlatform: "polygon-pos" },
  arbitrum: { sub: "arb-mainnet", native: { symbol: "ETH", coingeckoId: "ethereum", decimals: 18 }, cgPlatform: "arbitrum-one" },
  optimism: { sub: "opt-mainnet", native: { symbol: "ETH", coingeckoId: "ethereum", decimals: 18 }, cgPlatform: "optimistic-ethereum" },
  bsc: { sub: "bnb-mainnet", native: { symbol: "BNB", coingeckoId: "binancecoin", decimals: 18 }, cgPlatform: "binance-smart-chain" },
};

const KEY = () => process.env.ALCHEMY_API_KEY;
export const ALCHEMY_ENABLED = () => Boolean(KEY());

async function rpc<T>(chain: string, method: string, params: unknown[], ttl = 30_000): Promise<T> {
  const net = ALCHEMY_NETWORKS[chain];
  if (!net) throw new Error(`alchemy: unsupported chain ${chain}`);
  const url = `https://${net.sub}.g.alchemy.com/v2/${KEY()}`;
  // fetchJson caches by URL; include method+params in a cache-busting fragment so distinct calls don't collide
  const r = await fetchJsonPost<{ result?: T; error?: { message: string } }>(url, { jsonrpc: "2.0", id: 1, method, params }, ttl);
  if (r.error) throw new Error(`alchemy ${method}: ${r.error.message}`);
  return r.result as T;
}

const postCache = new Map<string, { v: unknown; exp: number }>();
async function fetchJsonPost<T>(url: string, body: unknown, ttl: number): Promise<T> {
  const key = url + JSON.stringify(body);
  const hit = postCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!res.ok) throw new Error(`alchemy HTTP ${res.status}`);
  const j = (await res.json()) as T;
  postCache.set(key, { v: j, exp: Date.now() + ttl });
  return j;
}
void fetchJson;

export interface EvmHolding {
  chain: string;
  address: string | null; // null = native coin
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  logo?: string;
}

export async function getEvmHoldings(chain: string, wallet: string): Promise<EvmHolding[]> {
  const net = ALCHEMY_NETWORKS[chain];
  const out: EvmHolding[] = [];
  const nativeHex = await rpc<string>(chain, "eth_getBalance", [wallet, "latest"]);
  const native = parseInt(nativeHex, 16) / 10 ** net.native.decimals;
  if (native > 0) out.push({ chain, address: null, symbol: net.native.symbol, name: net.native.symbol, decimals: net.native.decimals, amount: native });

  const bal = await rpc<{ tokenBalances: { contractAddress: string; tokenBalance: string | null }[] }>(chain, "alchemy_getTokenBalances", [wallet, "erc20"]);
  const nonZero = bal.tokenBalances.filter((t) => t.tokenBalance && t.tokenBalance !== "0x0" && parseInt(t.tokenBalance, 16) > 0).slice(0, 60);
  const metas = await Promise.all(nonZero.map((t) => rpc<{ symbol: string | null; name: string | null; decimals: number | null; logo: string | null }>(chain, "alchemy_getTokenMetadata", [t.contractAddress], 3_600_000).catch(() => null)));
  nonZero.forEach((t, i) => {
    const m = metas[i];
    if (!m || m.decimals == null || !m.symbol) return; // spam / unknown tokens
    const amount = parseInt(t.tokenBalance!, 16) / 10 ** m.decimals;
    if (amount <= 0) return;
    out.push({ chain, address: t.contractAddress.toLowerCase(), symbol: m.symbol, name: m.name ?? m.symbol, decimals: m.decimals, amount, logo: m.logo ?? undefined });
  });
  return out;
}

export interface EvmTransfer {
  hash: string;
  chain: string;
  timestamp: string | null;
  from: string;
  to: string;
  direction: "in" | "out";
  asset: string;
  value: number | null;
  category: string;
}

export async function getEvmTransfers(chain: string, wallet: string, limit = 50): Promise<EvmTransfer[]> {
  const base = { fromBlock: "0x0", toBlock: "latest", category: ["external", "erc20"], withMetadata: true, excludeZeroValue: true, maxCount: `0x${limit.toString(16)}`, order: "desc" };
  const [outR, inR] = await Promise.all([
    rpc<{ transfers: any[] }>(chain, "alchemy_getAssetTransfers", [{ ...base, fromAddress: wallet }], 60_000).catch(() => ({ transfers: [] })), // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc<{ transfers: any[] }>(chain, "alchemy_getAssetTransfers", [{ ...base, toAddress: wallet }], 60_000).catch(() => ({ transfers: [] })), // eslint-disable-line @typescript-eslint/no-explicit-any
  ]);
  const w = wallet.toLowerCase();
  const all = [...outR.transfers, ...inR.transfers].map((t) => ({
    hash: t.hash,
    chain,
    timestamp: t.metadata?.blockTimestamp ?? null,
    from: t.from,
    to: t.to,
    direction: (t.from?.toLowerCase() === w ? "out" : "in") as "in" | "out",
    asset: t.asset ?? "?",
    value: t.value ?? null,
    category: t.category,
  }));
  const seen = new Set<string>();
  return all.filter((t) => { const k = t.hash + t.asset + t.direction; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "")).slice(0, limit);
}
