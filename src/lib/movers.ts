// Stage 39 - Market Movers: today's biggest gainers and losers among real coins (market cap floor), volume spikes
// from the screener, and what entered or left Confirmed in the last 24 hours. Tagged with whether each coin is
// listed on the user's exchange.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarkets } from "./providers/coingecko";
import { venueListings, venuesFor, type VenueId } from "./venues";
import { safe } from "./fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Mover { id: string; symbol: string; name: string; price: number | null; change24h: number | null; change1h: number | null; marketCap: number | null; volume: number | null; listed: boolean }
export interface Movers {
  gainers: Mover[]; losers: Mover[];
  volume: { symbol: string; coingeckoId: string | null; ratio: number; outlook: string | null; change24h: number | null; listed: boolean }[];
  confirmedNew: { symbol: string; coingeckoId: string | null; timeframe: string; at: string; side: string | null; listed: boolean }[];
  confirmedLost: { symbol: string; coingeckoId: string | null; timeframe: string; at: string; reason: string | null }[];
  breadth: { up: number; down: number; total: number } | null;
  generatedAt: string;
}

const STABLE = /^(USDT|USDC|DAI|FDUSD|TUSD|USDE|PYUSD|USDS|BUSD|EURC|USD0|USDD|FRAX)$/;

export async function buildMovers(sb: SupabaseClient | null, venue: VenueId, opts: { minCap?: number; limit?: number } = {}): Promise<Movers> {
  const minCap = opts.minCap ?? 50_000_000, limit = opts.limit ?? 8;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [p1, p2, listings, vol, hist] = await Promise.all([
    safe(getMarkets(1, 250, false)), safe(getMarkets(2, 250, false)), venueListings(),
    sb ? sb.from("coin_metrics").select("asset_key, symbol, vol_ratio, outlook, change_24h_pct").eq("timeframe", "4h").gte("vol_ratio", 2).order("vol_ratio", { ascending: false }).limit(limit) : Promise.resolve({ data: [] as any[] }),
    sb ? sb.from("category_history").select("asset_key, symbol, timeframe, category, prev_category, reason, changed_at, snapshot").gte("changed_at", since).or("category.eq.confirmed,prev_category.eq.confirmed").order("changed_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] as any[] }),
  ]);
  const rows = [...(p1.ok ? p1.data : []), ...(p2.ok ? p2.data : [])].filter((r) => !STABLE.test(r.symbol) && (r.marketCapUsd ?? 0) >= minCap && r.change24hPct != null);
  const listed = (sym: string) => venuesFor(sym, listings, venue).includes(venue);
  const toM = (r: any): Mover => ({ id: r.id, symbol: r.symbol, name: r.name, price: r.priceUsd, change24h: r.change24hPct, change1h: r.change1hPct, marketCap: r.marketCapUsd, volume: r.volume24hUsd, listed: listed(r.symbol) });
  const sorted = [...rows].sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0));
  const cg = (k: string) => (String(k).startsWith("cg:") ? String(k).slice(3) : null);
  const h = (hist as any).data ?? [];
  return {
    gainers: sorted.slice(0, limit).map(toM),
    losers: sorted.slice(-limit).reverse().map(toM),
    volume: ((vol as any).data ?? []).map((v: any) => ({ symbol: v.symbol, coingeckoId: cg(v.asset_key), ratio: +Number(v.vol_ratio).toFixed(1), outlook: v.outlook, change24h: v.change_24h_pct, listed: listed(v.symbol) })),
    confirmedNew: h.filter((x: any) => x.category === "confirmed").slice(0, limit).map((x: any) => ({ symbol: x.symbol, coingeckoId: cg(x.asset_key), timeframe: x.timeframe, at: x.changed_at, side: x.snapshot?.setup?.side ?? null, listed: listed(x.symbol) })),
    confirmedLost: h.filter((x: any) => x.prev_category === "confirmed" && x.category !== "confirmed").slice(0, limit).map((x: any) => ({ symbol: x.symbol, coingeckoId: cg(x.asset_key), timeframe: x.timeframe, at: x.changed_at, reason: x.reason ?? null })),
    breadth: rows.length ? { up: rows.filter((r) => (r.change24hPct ?? 0) > 0).length, down: rows.filter((r) => (r.change24hPct ?? 0) < 0).length, total: rows.length } : null,
    generatedAt: new Date().toISOString(),
  };
}
