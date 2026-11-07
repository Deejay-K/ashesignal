// New-listing detection: CoinGecko "recently added" + DexScreener latest token profiles,
// diffed against the seen_listings watermark. First run only seeds the watermark.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchJson, safe } from "@/lib/fetch";
import { getLatestProfiles } from "@/lib/providers/dexscreener";

export interface NewListing { key: string; symbol: string; name: string; chain: string; source: string; url?: string }

const CG_BASE = process.env.COINGECKO_PRO_API_KEY ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const CG_HEADERS: Record<string, string> = process.env.COINGECKO_PRO_API_KEY ? { "x-cg-pro-api-key": process.env.COINGECKO_PRO_API_KEY } : process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};

export async function detectNewListings(sb: SupabaseClient): Promise<{ fresh: NewListing[]; seeded: boolean }> {
  const found: NewListing[] = [];
  const cg = await safe(fetchJson<{ id: string; symbol: string; name: string; activated_at?: number }[]>(`${CG_BASE}/coins/list/new`, { provider: "coingecko", headers: CG_HEADERS, ttl: 600_000 }));
  if (cg.ok) for (const c of cg.data.slice(0, 50)) found.push({ key: `cg:${c.id}`, symbol: c.symbol.toUpperCase(), name: c.name, chain: "cex/aggregated", source: "coingecko", url: `/token/${c.id}` });
  const dx = await safe(getLatestProfiles());
  if (dx.ok) for (const p of dx.data.slice(0, 60)) found.push({ key: `dex:${p.chainId}:${p.tokenAddress}`, symbol: p.tokenAddress.slice(0, 6) + "…", name: p.description?.slice(0, 60) ?? p.tokenAddress, chain: p.chainId, source: "dexscreener", url: `/scanner?address=${p.tokenAddress}` });
  if (!found.length) return { fresh: [], seeded: false };
  const { count } = await sb.from("seen_listings").select("key", { count: "exact", head: true });
  const { data: seen } = await sb.from("seen_listings").select("key").in("key", found.map((f) => f.key));
  const seenSet = new Set((seen ?? []).map((s) => s.key));
  const fresh = found.filter((f) => !seenSet.has(f.key));
  if (fresh.length) await sb.from("seen_listings").upsert(fresh.map((f) => ({ key: f.key, symbol: f.symbol, chain: f.chain })), { onConflict: "key", ignoreDuplicates: true });
  const seeded = (count ?? 0) === 0;
  return { fresh: seeded ? [] : fresh, seeded };
}
