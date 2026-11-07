import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets, getCoin, getMarketChart } from "@/lib/providers/coingecko";
import { buildSpot, polishWhy } from "@/lib/market/spot";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXCLUDE = /usd|usdt|usdc|dai|fdusd|tusd|pyusd|usde|wrapped|wbtc|weth|steth|wsteth|cbbtc|reth|weeth|frax|eurc|eurs|xaut|paxg/i;

/**
 * Spot investment picks: rotates through the top 150 coins (5 per call, stablecoins and wrappers skipped),
 * fetches fundamentals + 1y daily prices, scores them and stores tiered picks in spot_picks.
 * Picks drop out when the score falls under 40 or the row goes a week without a refresh.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const top = await safe(getMarkets(1, 150, false));
  if (!top.ok) return NextResponse.json({ error: top.error }, { status: 502 });
  const coins = top.data.filter((c) => !EXCLUDE.test(c.symbol) && !EXCLUDE.test(c.id) && !EXCLUDE.test(c.name));
  const url = new URL(req.url);
  const BATCH = Number(url.searchParams.get("n") ?? 5);
  const batches = Math.ceil(coins.length / BATCH);
  const batch = url.searchParams.get("batch") != null ? Number(url.searchParams.get("batch")) % batches : Math.floor(Date.now() / 300_000) % batches;
  const slice = coins.slice(batch * BATCH, batch * BATCH + BATCH);

  const btc = top.data.find((c) => c.id === "bitcoin");
  const eth = top.data.find((c) => c.id === "ethereum");
  const [btcD, ethD] = await Promise.all([btc ? safe(getCoin("bitcoin")) : null, eth ? safe(getCoin("ethereum")) : null]);
  const btc1y = btcD?.ok ? btcD.data.change1yPct : null;
  const eth1y = ethD?.ok ? ethD.data.change1yPct : null;

  const { data: prevRows } = await sb.from("spot_picks").select("asset_key, tier").in("asset_key", slice.map((c) => `cg:${c.id}`));
  const prev = new Map((prevRows ?? []).map((r) => [r.asset_key, r.tier]));
  const rows: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  const dropped: string[] = [];
  const errors: string[] = [];
  for (const c of slice) {
    const [coin, chart] = await Promise.all([safe(getCoin(c.id)), safe(getMarketChart(c.id, 365))]);
    if (!coin.ok || !chart.ok) { errors.push(`${c.symbol}: ${!coin.ok ? coin.error : !chart.ok ? chart.error : ""}`); continue; }
    const closes = chart.data.prices.map((p) => p[1]);
    let d = buildSpot({ coin: coin.data, dailyCloses: closes, btc1y, eth1y });
    if (!d) continue;
    const key = `cg:${c.id}`;
    if (d.score < 40) {
      if (prev.has(key)) { dropped.push(key); history.push({ asset_key: key, symbol: c.symbol, category: "none", prev_category: "spot", reason: `Spot score fell to ${d.score}; removed from Spot Investments.`, snapshot: { price: c.priceUsd, score: d.score } }); }
      continue;
    }
    d = await polishWhy(d, coin.data.name);
    rows.push({ asset_key: key, symbol: c.symbol, name: c.name, tier: d.tier, rank: c.rank, price: c.priceUsd, market_cap: c.marketCapUsd, volume_24h: c.volume24hUsd, spot_score: d.score, detail: d, updated_at: new Date().toISOString() });
    const before = prev.get(key);
    if (before !== d.tier) history.push({ asset_key: key, symbol: c.symbol, category: "spot", prev_category: before ? "spot" : "none", reason: before ? `Tier changed from ${before} to ${d.tier}.` : `Entered Spot Investments as ${d.tier} with score ${d.score}.`, snapshot: { price: c.priceUsd, score: d.score, tier: d.tier } });
  }
  if (rows.length) {
    const { error } = await sb.from("spot_picks").upsert(rows, { onConflict: "asset_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (dropped.length) await sb.from("spot_picks").delete().in("asset_key", dropped);
  if (history.length) await sb.from("category_history").insert(history);
  await sb.from("spot_picks").delete().lt("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  return NextResponse.json({ ok: true, batch, batches, stored: rows.length, dropped: dropped.length, errors: errors.slice(0, 5) });
}
