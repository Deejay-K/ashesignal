// Portfolio aggregation: wallets → holdings → USD values → allocation + network split.
// Prices: CoinGecko token_price by contract (batched per platform), native coins by id,
// DexScreener for anything CoinGecko doesn't know. Every value carries its source.

import { fetchJson, safe } from "@/lib/fetch";
import { ALCHEMY_ENABLED, ALCHEMY_NETWORKS, getEvmHoldings, getEvmTransfers, type EvmTransfer } from "@/lib/providers/alchemy";
import { HELIUS_ENABLED, getSolHoldings, getSolTransfers, type SolTransfer } from "@/lib/providers/helius";
import { getPairsForTokens } from "@/lib/providers/dexscreener";

export interface Holding {
  dust?: boolean;
  wallet: string;
  walletLabel: string | null;
  chain: string;
  address: string | null;
  symbol: string;
  name: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  priceSource: "coingecko" | "dexscreener" | "helius" | "unavailable";
  change24hPct: number | null;
  logo?: string;
  costBasis?: number | null; // user-entered avg cost per unit
  unrealizedUsd?: number | null;
  unrealizedPct?: number | null;
}

export interface Portfolio {
  totalUsd: number;
  pricedPct: number;
  dustCount?: number; // % of holdings (by count) that have a price
  holdings: Holding[];
  byChain: { chain: string; valueUsd: number; pct: number }[];
  byAsset: { symbol: string; valueUsd: number; pct: number }[];
  transactions: (EvmTransfer | SolTransfer)[];
  errors: string[];
  providers: { alchemy: boolean; helius: boolean };
  generatedAt: number;
}

export interface WalletRef {
  chain: string;
  address: string;
  label: string | null;
}

/** Exchange balances supplied by the caller (already decrypted + fetched). */
export interface ExchangeHoldingInput { exchange: string; label: string | null; asset: string; amount: number; avgCost?: number | null }

const CG_BASE = process.env.COINGECKO_PRO_API_KEY ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const CG_HEADERS: Record<string, string> = process.env.COINGECKO_PRO_API_KEY ? { "x-cg-pro-api-key": process.env.COINGECKO_PRO_API_KEY } : process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};

export async function buildPortfolio(wallets: WalletRef[], costBasis: Record<string, number> = {}, exchangeHoldings: ExchangeHoldingInput[] = []): Promise<Portfolio> {
  const errors: string[] = [];
  const holdings: Holding[] = [];
  const transactions: (EvmTransfer | SolTransfer)[] = [];
  for (const x of exchangeHoldings) {
    if (!(x.amount > 0)) continue;
    const stable = ["USD", "USDT", "USDC", "FDUSD", "DAI", "TUSD", "CAD", "EUR", "GBP"].includes(x.asset);
    holdings.push({ wallet: x.exchange, walletLabel: x.label ?? x.exchange, chain: x.exchange, address: `cex:${x.asset}`, symbol: x.asset, name: x.asset, amount: x.amount, priceUsd: stable ? 1 : null, valueUsd: stable ? x.amount : null, priceSource: stable ? "coingecko" : "unavailable", change24hPct: stable ? 0 : null, costBasis: x.avgCost ?? null });
  }

  await Promise.all(
    wallets.map(async (w) => {
      if (w.chain === "solana") {
        if (!HELIUS_ENABLED()) return errors.push(`Solana wallet ${short(w.address)}: HELIUS_API_KEY not set.`);
        const h = await safe(getSolHoldings(w.address));
        if (!h.ok) return errors.push(`Solana ${short(w.address)}: ${h.error}`);
        for (const x of h.data) holdings.push({ wallet: w.address, walletLabel: w.label, chain: "solana", address: x.address, symbol: x.symbol, name: x.name, amount: x.amount, priceUsd: x.priceUsd ?? null, valueUsd: x.priceUsd != null ? x.priceUsd * x.amount : null, priceSource: x.priceUsd != null ? "helius" : "unavailable", change24hPct: null, logo: x.logo });
        const t = await safe(getSolTransfers(w.address, 30));
        if (t.ok) transactions.push(...t.data);
      } else if (ALCHEMY_NETWORKS[w.chain]) {
        if (!ALCHEMY_ENABLED()) return errors.push(`${w.chain} wallet ${short(w.address)}: ALCHEMY_API_KEY not set.`);
        const h = await safe(getEvmHoldings(w.chain, w.address));
        if (!h.ok) return errors.push(`${w.chain} ${short(w.address)}: ${h.error}`);
        for (const x of h.data) holdings.push({ wallet: w.address, walletLabel: w.label, chain: w.chain, address: x.address, symbol: x.symbol, name: x.name, amount: x.amount, priceUsd: null, valueUsd: null, priceSource: "unavailable", change24hPct: null, logo: x.logo });
        const t = await safe(getEvmTransfers(w.chain, w.address, 30));
        if (t.ok) transactions.push(...t.data);
      } else errors.push(`Unsupported chain ${w.chain}.`);
    }),
  );

  await priceHoldings(holdings, errors);

  for (const h of holdings) {
    const cb = costBasis[`${h.chain}:${h.address ?? "native"}`] ?? h.costBasis ?? undefined;
    if (cb != null && h.priceUsd != null) {
      h.costBasis = cb;
      h.unrealizedUsd = (h.priceUsd - cb) * h.amount;
      h.unrealizedPct = cb > 0 ? ((h.priceUsd - cb) / cb) * 100 : null;
    }
  }

  // Dust: exchange rounding leftovers (worth under one cent, or an unpriceable sliver under 1e-6 units).
  // Kept in the list with a flag so the UI can hide them by default; excluded from totals and allocation.
  for (const h of holdings) h.dust = (h.valueUsd != null && h.valueUsd < 0.01) || (h.valueUsd == null && h.amount < 1e-6) || (h.priceSource === "unavailable" && h.amount < 1e-3);
  const live = holdings.filter((h) => !h.dust);
  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const totalUsd = live.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const group = (key: (h: Holding) => string) => {
    const m = new Map<string, number>();
    live.forEach((h) => m.set(key(h), (m.get(key(h)) ?? 0) + (h.valueUsd ?? 0)));
    return [...m.entries()].map(([k, v]) => ({ key: k, valueUsd: v, pct: totalUsd ? (v / totalUsd) * 100 : 0 })).sort((a, b) => b.valueUsd - a.valueUsd);
  };
  return {
    totalUsd,
    pricedPct: live.length ? (live.filter((h) => h.priceUsd != null).length / live.length) * 100 : 100,
    dustCount: holdings.length - live.length,
    holdings,
    byChain: group((h) => h.chain).map((g) => ({ chain: g.key, valueUsd: g.valueUsd, pct: g.pct })),
    byAsset: group((h) => h.symbol).map((g) => ({ symbol: g.key, valueUsd: g.valueUsd, pct: g.pct })),
    transactions: transactions.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "")).slice(0, 60),
    errors,
    providers: { alchemy: ALCHEMY_ENABLED(), helius: HELIUS_ENABLED() },
    generatedAt: Date.now(),
  };
}

async function priceHoldings(holdings: Holding[], errors: string[]) {
  // 0) exchange holdings (symbol only): map symbol -> coingecko id via top-500 markets
  const cex = holdings.filter((h) => h.address?.startsWith("cex:") && h.priceUsd == null);
  if (cex.length) {
    try {
      const top = await fetchJson<{ id: string; symbol: string; current_price: number; price_change_percentage_24h: number | null }[]>(`${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1`, { provider: "coingecko", headers: CG_HEADERS, ttl: 120_000 });
      const top2 = await fetchJson<typeof top>(`${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2`, { provider: "coingecko", headers: CG_HEADERS, ttl: 120_000 }).catch(() => [] as typeof top);
      const bySym = new Map<string, (typeof top)[number]>();
      for (const c of [...top, ...top2]) if (!bySym.has(c.symbol.toUpperCase())) bySym.set(c.symbol.toUpperCase(), c);
      for (const h of cex) {
        const c = bySym.get(h.symbol.toUpperCase());
        if (c) Object.assign(h, { priceUsd: c.current_price, valueUsd: c.current_price * h.amount, priceSource: "coingecko", change24hPct: c.price_change_percentage_24h ?? null });
      }
    } catch (e) {
      errors.push("CoinGecko prices for exchange balances: " + (e as Error).message);
    }
  }
  // 1) native coins by CoinGecko id
  const nativeIds = new Set<string>();
  for (const h of holdings) if (h.address == null && h.chain !== "solana") nativeIds.add(ALCHEMY_NETWORKS[h.chain].native.coingeckoId);
  if (holdings.some((h) => h.chain === "solana" && h.address == null && h.priceUsd == null)) nativeIds.add("solana");
  if (nativeIds.size) {
    const r = await safe(fetchJson<Record<string, { usd: number; usd_24h_change?: number }>>(`${CG_BASE}/simple/price?ids=${[...nativeIds].join(",")}&vs_currencies=usd&include_24hr_change=true`, { provider: "coingecko", headers: CG_HEADERS, ttl: 60_000 }));
    if (r.ok) {
      for (const h of holdings) {
        if (h.address != null || h.priceUsd != null) continue;
        const id = h.chain === "solana" ? "solana" : ALCHEMY_NETWORKS[h.chain].native.coingeckoId;
        const p = r.data[id];
        if (p) Object.assign(h, { priceUsd: p.usd, valueUsd: p.usd * h.amount, priceSource: "coingecko", change24hPct: p.usd_24h_change ?? null });
      }
    } else errors.push("CoinGecko native prices: " + r.error);
  }
  // 2) tokens by contract, per platform
  const byPlatform = new Map<string, Holding[]>();
  for (const h of holdings) {
    if (h.address == null || h.priceUsd != null) continue;
    const platform = h.chain === "solana" ? "solana" : ALCHEMY_NETWORKS[h.chain]?.cgPlatform;
    if (!platform) continue;
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), h]);
  }
  for (const [platform, hs] of byPlatform) {
    for (let i = 0; i < hs.length; i += 50) {
      const chunk = hs.slice(i, i + 50);
      const r = await safe(fetchJson<Record<string, { usd: number; usd_24h_change?: number }>>(`${CG_BASE}/simple/token_price/${platform}?contract_addresses=${chunk.map((h) => h.address).join(",")}&vs_currencies=usd&include_24hr_change=true`, { provider: "coingecko", headers: CG_HEADERS, ttl: 60_000 }));
      if (!r.ok) {
        errors.push(`CoinGecko token prices (${platform}): ${r.error}`);
        continue;
      }
      for (const h of chunk) {
        const p = r.data[h.address!.toLowerCase()] ?? r.data[h.address!];
        if (p) Object.assign(h, { priceUsd: p.usd, valueUsd: p.usd * h.amount, priceSource: "coingecko", change24hPct: p.usd_24h_change ?? null });
      }
    }
  }
  // 3) DexScreener for the rest (grouped by chain)
  const byChain = new Map<string, Holding[]>();
  for (const h of holdings) if (h.address != null && h.priceUsd == null) byChain.set(h.chain, [...(byChain.get(h.chain) ?? []), h]);
  for (const [chain, hs] of byChain) {
    const r = await safe(getPairsForTokens(chain, hs.map((h) => h.address!)));
    if (!r.ok) continue;
    for (const h of hs) {
      const pairs = r.data.filter((p) => p.baseToken.address.toLowerCase() === h.address!.toLowerCase() && p.priceUsd != null).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
      const best = pairs[0];
      if (best && (best.liquidityUsd ?? 0) > 1000) Object.assign(h, { priceUsd: best.priceUsd, valueUsd: best.priceUsd! * h.amount, priceSource: "dexscreener", change24hPct: best.priceChange.h24 });
    }
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
