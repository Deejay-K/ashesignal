import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getTrendingPools, getNewPools } from "@/lib/providers/geckoterminal";
import { getTopBoosted } from "@/lib/providers/dexscreener";
import { scanAddress } from "@/lib/market/scan";
import { buildSpecDetail, type SpecSource } from "@/lib/market/speculative";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GT_TO_DEX: Record<string, string> = { eth: "ethereum", bsc: "bsc", base: "base", solana: "solana", arbitrum: "arbitrum", polygon_pos: "polygon", avax: "avalanche", optimism: "optimism" };

/**
 * Speculative opportunities: candidates from GeckoTerminal trending + new pools and DexScreener boosts.
 * Each call scans a rotating batch of 6 candidates (security, age, liquidity, momentum, 1h/4h TA) and
 * stores them in spec_opportunities. Rows not refreshed for 24h, or whose liquidity collapsed, are removed.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });

  const [trend, fresh, boosted] = await Promise.all([safe(getTrendingPools()), safe(getNewPools()), safe(getTopBoosted())]);
  type Cand = { chain: string; address: string; source: SpecSource; spike: number | null; liq: number | null };
  const cands = new Map<string, Cand>();
  const add = (c: Cand) => { const k = `${c.chain}:${c.address.toLowerCase()}`; if (!cands.has(k)) cands.set(k, c); };
  if (trend.ok) for (const p of trend.data) if (p.baseTokenAddress && GT_TO_DEX[p.network] && (p.liquidityUsd ?? 0) >= 15_000) add({ chain: GT_TO_DEX[p.network], address: p.baseTokenAddress, source: p.volume24h && p.liquidityUsd && p.volume24h / p.liquidityUsd >= 3 ? "unusual-volume" : "trending", spike: p.volume24h && p.liquidityUsd ? p.volume24h / p.liquidityUsd : null, liq: p.liquidityUsd });
  if (fresh.ok) for (const p of fresh.data) if (p.baseTokenAddress && GT_TO_DEX[p.network] && (p.liquidityUsd ?? 0) >= 15_000 && (p.volume24h ?? 0) >= 20_000) add({ chain: GT_TO_DEX[p.network], address: p.baseTokenAddress, source: "new", spike: null, liq: p.liquidityUsd });
  if (boosted.ok) for (const b of boosted.data.slice(0, 15)) add({ chain: b.chainId, address: b.tokenAddress, source: "boosted", spike: null, liq: null });

  const list = [...cands.values()];
  const url = new URL(req.url);
  const BATCH = 6;
  const batches = Math.max(1, Math.ceil(list.length / BATCH));
  const batch = url.searchParams.get("batch") != null ? Number(url.searchParams.get("batch")) % batches : Math.floor(new Date().getMinutes() / 5) % batches;
  const slice = list.slice(batch * BATCH, batch * BATCH + BATCH);

  const { data: prevRows } = await sb.from("spec_opportunities").select("asset_key, first_seen").in("asset_key", slice.map((c) => `addr:${c.chain}:${c.address.toLowerCase()}`));
  const prev = new Set((prevRows ?? []).map((r) => r.asset_key));
  const rows: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  const errors: string[] = [];
  await Promise.all(slice.map(async (c) => {
    const r = await safe(scanAddress(c.address, ["1h", "4h"]));
    if (!r.ok) { errors.push(`${c.address.slice(0, 8)}: ${r.error}`); return; }
    const rep = r.data;
    if (!rep.token || rep.market.priceUsd == null) return;
    if ((rep.market.liquidityUsd ?? 0) < 10_000) return; // not tradeable at all
    if (rep.security && rep.security.riskScore >= 90) return; // honeypot-grade: do not list
    const key = `addr:${rep.chain?.id ?? c.chain}:${rep.address.toLowerCase()}`;
    const detail = buildSpecDetail(rep, c.source, { volumeSpike: c.spike });
    rows.push({
      asset_key: key, chain: rep.chain?.id ?? c.chain, address: rep.address, symbol: rep.token.symbol, name: rep.token.name,
      price: rep.market.priceUsd, liquidity_usd: rep.market.liquidityUsd, volume_24h: rep.market.volume24h, market_cap: rep.market.marketCap, fdv: rep.market.fdv,
      age_hours: rep.market.ageHours, change_1h: rep.market.change.h1, change_24h: rep.market.change.h24, buy_sell_ratio: rep.market.buySellRatio24h, txns_24h: rep.market.txns24h,
      risk_level: rep.verdict.riskLevel, security_score: rep.security?.riskScore ?? null, source_tag: c.source, detail, updated_at: new Date().toISOString(),
    });
    if (!prev.has(key)) history.push({ asset_key: key, symbol: rep.token.symbol, timeframe: detail.ta?.timeframe ?? null, category: "speculative", prev_category: "none", reason: detail.attention[0], snapshot: { price: rep.market.priceUsd, liquidity: rep.market.liquidityUsd, risk: rep.verdict.riskLevel } });
  }));
  if (rows.length) {
    const { error } = await sb.from("spec_opportunities").upsert(rows, { onConflict: "asset_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (history.length) await sb.from("category_history").insert(history);
  // expire: stale 24h or liquidity gone
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: stale } = await sb.from("spec_opportunities").select("asset_key, symbol").lt("updated_at", cutoff);
  if (stale?.length) {
    await sb.from("category_history").insert(stale.map((s) => ({ asset_key: s.asset_key, symbol: s.symbol, category: "none", prev_category: "speculative", reason: "No longer trending or refreshed for 24h; removed from Speculative." })));
    await sb.from("spec_opportunities").delete().lt("updated_at", cutoff);
  }
  return NextResponse.json({ ok: true, candidates: list.length, batch, batches, stored: rows.length, newEntries: history.length, expired: stale?.length ?? 0, errors: errors.slice(0, 5) });
}
