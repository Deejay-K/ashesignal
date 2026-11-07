import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Opportunity, RiskLevel } from "@/lib/market/opportunities";
import { liveTaCategories, liveSpeculative, liveSpot, within } from "@/lib/market/live-opportunities";
import { venueFromRequest } from "@/lib/venue-pref";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function riskFromMetrics(r: any): RiskLevel {
  const atr = Number(r.atr_pct ?? 0);
  const kind = r.setup_kind;
  if (kind === "confirmed" && atr < 4) return "low";
  if (atr > 10 || kind === "watch") return "high";
  return "medium";
}

export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  const cat = req.nextUrl.searchParams.get("cat") ?? "all";
  const wantLive = req.nextUrl.searchParams.get("live") === "1";
  const items: Opportunity[] = [];
  const live: string[] = [];
  const want = (c: string) => cat === "all" || cat === c;
  const fill = async () => {
    // Live fallback: any category the worker has not filled yet is computed on request from current market data.
    const has = (c: string) => items.some((i) => i.category === c);
    const jobs: Promise<void>[] = [];
    if ((want("confirmed") || want("watching")) && (wantLive || (!has("confirmed") && !has("watching")))) jobs.push(within(liveTaCategories(40, venueFromRequest(req)), 40_000, []).then((x) => { const add = x.filter((i) => want(i.category)); if (add.length) { items.push(...add); live.push("confirmed", "watching"); } }));
    if (want("speculative") && (wantLive || !has("speculative"))) jobs.push(within(liveSpeculative(4), 40_000, []).then((x) => { if (x.length) { items.push(...x); live.push("speculative"); } }));
    if (want("spot") && (wantLive || !has("spot"))) jobs.push(within(liveSpot(6), 40_000, []).then((x) => { if (x.length) { items.push(...x); live.push("spot"); } }));
    await Promise.all(jobs);
  };
  if (!sb) {
    await fill();
    const newest0 = items.reduce((m, i) => Math.max(m, Date.parse(i.updatedAt)), 0);
    return NextResponse.json({ items, updatedAt: newest0 || null, live, note: items.length ? undefined : "Live snapshot unavailable and no worker configured (SUPABASE_SERVICE_ROLE_KEY). See docs/SETUP.md section 14.", counts: counts(items) });
  }

  if (cat === "all" || cat === "confirmed" || cat === "watching") {
    let q = sb.from("coin_metrics").select("*").neq("category", "none").not("category", "is", null);
    if (cat !== "all") q = q.eq("category", cat);
    const { data } = await q.order("updated_at", { ascending: false }).limit(600);
    for (const r of data ?? []) {
      const d = r.detail ?? {};
      const s = d.setup ?? null;
      const tp2 = s?.takeProfits?.[1]?.price ?? s?.takeProfits?.[0]?.price ?? null;
      const entry = s?.entry?.mid ?? r.price;
      items.push({
        id: `${r.asset_key}|${r.timeframe}`, assetKey: r.asset_key, category: r.category, symbol: r.symbol, name: r.name ?? r.symbol, chain: r.venue ?? "binance",
        price: r.price, marketCap: r.market_cap, volume24h: r.volume_24h, liquidity: r.volume_24h, side: s?.side ?? null,
        bias: r.outlook?.includes("bull") ? "bullish" : r.outlook?.includes("bear") ? "bearish" : "neutral",
        risk: riskFromMetrics(r), timeframe: r.timeframe, rr: s?.rr ?? r.setup_rr ?? null, confidence: s?.confidence ?? r.setup_confidence ?? null,
        upsidePct: tp2 != null && entry ? Math.abs((tp2 - entry) / entry) * 100 : null, tokenCategories: [],
        firstSeen: r.category_since ?? r.updated_at, updatedAt: r.updated_at, href: `/token/${r.asset_key.replace(/^cg:/, "")}?tf=${r.timeframe}`,
        detail: d, spec: null, spot: null, tier: null, liquidityNote: r.liquidity_note ?? null,
      });
    }
  }
  if (cat === "all" || cat === "speculative") {
    const { data } = await sb.from("spec_opportunities").select("*").order("updated_at", { ascending: false }).limit(200);
    for (const r of data ?? []) {
      const d = r.detail ?? {};
      const tp = d.targets?.tp?.[1]?.price ?? d.targets?.tp?.[0]?.price ?? null;
      items.push({
        id: r.asset_key, assetKey: r.asset_key, category: "speculative", symbol: r.symbol ?? "?", name: r.name ?? r.symbol ?? "?", chain: r.chain,
        price: r.price, marketCap: r.market_cap ?? r.fdv, volume24h: r.volume_24h, liquidity: r.liquidity_usd, side: d.targets?.side ?? null,
        bias: d.ta ? (String(d.ta.outlook).includes("bull") ? "bullish" : String(d.ta.outlook).includes("bear") ? "bearish" : "neutral") : (r.change_24h ?? 0) > 0 ? "bullish" : "bearish",
        risk: r.risk_level ?? "extreme", timeframe: d.ta?.timeframe ?? null, rr: null, confidence: d.targets?.justified && d.ta ? Math.round(50 + Math.abs(d.ta.score) / 4) : null,
        upsidePct: tp != null && r.price ? Math.abs((tp - r.price) / r.price) * 100 : null, tokenCategories: [r.source_tag].filter(Boolean),
        firstSeen: r.first_seen, updatedAt: r.updated_at, href: `/scanner?address=${encodeURIComponent(r.address)}`,
        detail: null, spec: d, spot: null, tier: null, liquidityNote: d.liquidity?.note ?? null,
      });
    }
  }
  if (cat === "all" || cat === "spot") {
    const { data } = await sb.from("spot_picks").select("*").order("spot_score", { ascending: false }).limit(200);
    for (const r of data ?? []) {
      const d = r.detail ?? {};
      const pt = d.analysis?.profitTaking?.[0]?.price ?? null;
      items.push({
        id: r.asset_key, assetKey: r.asset_key, category: "spot", symbol: r.symbol ?? "?", name: r.name ?? r.symbol ?? "?", chain: d.fundamentals?.chains?.[0] ?? null,
        price: r.price, marketCap: r.market_cap, volume24h: r.volume_24h, liquidity: r.volume_24h, side: null,
        bias: d.structure?.trend === "up" ? "bullish" : d.structure?.trend === "down" ? "bearish" : "neutral",
        risk: r.tier === "established" ? "low" : r.tier === "emerging" ? "medium" : "high", timeframe: "1w", rr: null, confidence: r.spot_score,
        upsidePct: pt != null && r.price ? ((pt - r.price) / r.price) * 100 : null, tokenCategories: d.fundamentals?.categories ?? [],
        firstSeen: r.updated_at, updatedAt: r.updated_at, href: `/token/${r.asset_key.replace(/^cg:/, "")}`,
        detail: null, spec: null, spot: d, tier: r.tier, liquidityNote: null,
      });
    }
  }
  await fill();
  const newest = items.reduce((m, i) => Math.max(m, Date.parse(i.updatedAt)), 0);
  return NextResponse.json({ items, updatedAt: newest || null, live, counts: counts(items) });
}

function counts(items: Opportunity[]) {
  return { confirmed: items.filter((i) => i.category === "confirmed").length, watching: items.filter((i) => i.category === "watching").length, speculative: items.filter((i) => i.category === "speculative").length, spot: items.filter((i) => i.category === "spot").length };
}
