// DEX liquidity tracking: the worker snapshots trending + new pools and every DEX token on a
// user watchlist or alert; discovery and alerts compare against the snapshot ~24h earlier.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTrendingPools, getNewPools } from "@/lib/providers/geckoterminal";
import { getPairsByToken } from "@/lib/providers/dexscreener";
import { safe } from "@/lib/fetch";

export interface LiquidityChange {
  chain: string;
  pool: string;
  symbol: string | null;
  tokenAddress: string | null;
  liquidityNow: number;
  liquidityBefore: number;
  changePct: number;
  hours: number;
  priceUsd: number | null;
  volume24h: number | null;
}

export async function snapshotPools(sb: SupabaseClient) {
  // cadence guard: at most one snapshot round every 25 minutes
  const { data: last } = await sb.from("pool_snapshots").select("taken_at").order("taken_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.taken_at).getTime() < 25 * 60_000) return 0;
  const rows: Record<string, unknown>[] = [];
  const [tr, nw] = await Promise.all([safe(getTrendingPools()), safe(getNewPools())]);
  for (const p of [...(tr.ok ? tr.data : []), ...(nw.ok ? nw.data : [])]) {
    if (!p.poolAddress || p.liquidityUsd == null) continue;
    rows.push({ chain: p.network, pool: p.poolAddress.toLowerCase(), symbol: p.name.split("/")[0].trim(), token_address: p.baseTokenAddress, liquidity_usd: p.liquidityUsd, volume24h_usd: p.volume24h, price_usd: p.priceUsd });
  }
  // DEX tokens users care about (watchlist items with an address + liquidity alerts)
  const [{ data: wl }, { data: al }] = await Promise.all([
    sb.from("watchlist_items").select("chain, address, symbol").not("address", "is", null).limit(200),
    sb.from("alerts").select("asset_ref, symbol").eq("type", "liquidity_change").eq("active", true).limit(200),
  ]);
  const addrs = new Map<string, string>();
  for (const w of wl ?? []) if (w.address) addrs.set(w.address, w.symbol);
  for (const a of al ?? []) { const r = a.asset_ref as { address?: string } | null; if (r?.address) addrs.set(r.address, a.symbol); }
  for (const [address] of addrs) {
    const pairs = await safe(getPairsByToken(address));
    if (!pairs.ok) continue;
    for (const p of pairs.data.slice(0, 3)) rows.push({ chain: p.chainId, pool: p.pairAddress.toLowerCase(), symbol: p.baseToken.symbol, token_address: p.baseToken.address, liquidity_usd: p.liquidityUsd, volume24h_usd: p.volume.h24, price_usd: p.priceUsd });
  }
  const seen = new Set<string>();
  const dedup = rows.filter((r) => { const k = `${r.chain}:${r.pool}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (dedup.length) {
    const { error } = await sb.from("pool_snapshots").insert(dedup);
    if (error) throw new Error(error.message);
  }
  // keep 7 days
  await sb.from("pool_snapshots").delete().lt("taken_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  return dedup.length;
}

/** Compare latest snapshot per pool against the one closest to `hours` ago. */
export async function liquidityChanges(sb: SupabaseClient, hours = 24, minLiq = 10_000, minPct = 25): Promise<LiquidityChange[]> {
  const since = new Date(Date.now() - (hours + 6) * 3_600_000).toISOString();
  const { data } = await sb.from("pool_snapshots").select("*").gte("taken_at", since).order("taken_at", { ascending: false }).limit(9000);
  const byPool = new Map<string, typeof data>();
  for (const r of data ?? []) { const k = `${r.chain}:${r.pool}`; byPool.set(k, [...(byPool.get(k) ?? []), r]); }
  const out: LiquidityChange[] = [];
  const target = Date.now() - hours * 3_600_000;
  for (const [, rows] of byPool) {
    if (!rows || rows.length < 2) continue;
    const now = rows[0];
    const before = rows.reduce((best, r) => (Math.abs(new Date(r.taken_at).getTime() - target) < Math.abs(new Date(best.taken_at).getTime() - target) ? r : best), rows[rows.length - 1]);
    if (before === now || now.liquidity_usd == null || before.liquidity_usd == null) continue;
    const ln = Number(now.liquidity_usd), lb = Number(before.liquidity_usd);
    if (Math.max(ln, lb) < minLiq || lb === 0) continue;
    const pct = ((ln - lb) / lb) * 100;
    if (Math.abs(pct) < minPct) continue;
    out.push({ chain: now.chain, pool: now.pool, symbol: now.symbol, tokenAddress: now.token_address, liquidityNow: ln, liquidityBefore: lb, changePct: pct, hours: (new Date(now.taken_at).getTime() - new Date(before.taken_at).getTime()) / 3_600_000, priceUsd: now.price_usd, volume24h: now.volume24h_usd });
  }
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 40);
}
