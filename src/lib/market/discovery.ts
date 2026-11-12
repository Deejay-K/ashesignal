// Trading Discovery, loaded the same way everywhere (website API, Telegram bot, digest): worker rows,
// live fallback when the worker has not filled a category, live re-verification of Confirmed rows, and
// venue tagging. Any screen that shows categories must go through loadDiscovery().

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity, RiskLevel } from "./opportunities";
import { liveTaCategories, liveSpeculative, liveSpot, within } from "./live-opportunities";
import { venueListings, venuesFor, VENUE_META, type VenueId } from "../venues";
import { getOhlcv } from "./ohlcv";
import { analyzeTimeframe } from "../ta/analysis";
import { holdCheck, demoteRow, SCREEN_CANDLES } from "./signal-state";
import type { Timeframe } from "../types";
import { safe } from "../fetch";
import { explainNoConfirmed, type WhyNone } from "./why";

/* eslint-disable @typescript-eslint/no-explicit-any */
function riskFromMetrics(r: any): RiskLevel {
  const atr = Number(r.atr_pct ?? 0);
  const kind = r.setup_kind;
  if (kind === "confirmed" && atr < 4) return "low";
  if (atr > 10 || kind === "watch") return "high";
  return "medium";
}


export interface DiscoveryResult { items: Opportunity[]; updatedAt: number | null; live: string[]; demoted: number; counts: ReturnType<typeof counts>; countsTradeable: ReturnType<typeof counts>; note?: string; /** Set when the user has no placeable Confirmed trade: what is blocking, and what is closest. */ why?: WhyNone | null }


export async function loadDiscovery(sb: SupabaseClient | null, opts: { cat?: string; venue: VenueId; live?: boolean; verifyBudgetMs?: number }): Promise<DiscoveryResult> {
  const cat = opts.cat ?? "all";
  const wantLive = !!opts.live;
  const active = opts.venue;
  const items: Opportunity[] = [];
  const live: string[] = [];
  const listingsP = venueListings();
  const tag = async () => { const l = await listingsP; for (const i of items) i.venues = i.category === "speculative" ? [] : venuesFor(i.symbol, l, active); };
  const want = (c: string) => cat === "all" || cat === c;
  const fill = async () => {
    const has = (c: string) => items.some((i) => i.category === c);
    const jobs: Promise<void>[] = [];
    if ((want("confirmed") || want("watching")) && (wantLive || (!has("confirmed") && !has("watching")))) jobs.push(within(liveTaCategories(40, active), 40_000, []).then((x) => { const add = x.filter((i) => want(i.category)); if (add.length) { items.push(...add); live.push("confirmed", "watching"); } }));
    if (want("speculative") && (wantLive || !has("speculative"))) jobs.push(within(liveSpeculative(4), 40_000, []).then((x) => { if (x.length) { items.push(...x); live.push("speculative"); } }));
    if (want("spot") && (wantLive || !has("spot"))) jobs.push(within(liveSpot(6), 40_000, []).then((x) => { if (x.length) { items.push(...x); live.push("spot"); } }));
    await Promise.all(jobs);
  };
  if (!sb) {
    await fill();
    await tag();
    const newest0 = items.reduce((m, i) => Math.max(m, Date.parse(i.updatedAt)), 0);
    return { items, updatedAt: newest0 || null, live, demoted: 0, counts: counts(items), countsTradeable: counts(tradeableOn(items, active)), note: items.length ? undefined : "Live snapshot unavailable and no worker configured (SUPABASE_SERVICE_ROLE_KEY). See docs/SETUP.md section 14." };
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
        venues: [], firstSeen: r.category_since ?? r.updated_at, updatedAt: r.updated_at, href: `/token/${r.asset_key.replace(/^cg:/, "")}?tf=${r.timeframe}`,
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
        venues: [], firstSeen: r.first_seen, updatedAt: r.updated_at, href: `/scanner?address=${encodeURIComponent(r.address)}`,
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
        venues: [], firstSeen: r.updated_at, updatedAt: r.updated_at, href: `/token/${r.asset_key.replace(/^cg:/, "")}`,
        detail: null, spec: null, spot: d, tier: r.tier, liquidityNote: null,
      });
    }
  }
  await fill();
  // Confirmed rows are re-checked against live candles before they are shown: the worker revisits a coin
  // about once an hour, and a setup can stop qualifying in between. Demotions are written back and logged.
  const demoted = await verifyConfirmed(items, sb, opts.verifyBudgetMs ?? 20_000);
  await tag();
  const newest = items.reduce((m, i) => Math.max(m, Date.parse(i.updatedAt)), 0);
  return { items, updatedAt: newest || null, live, demoted, counts: counts(items), countsTradeable: counts(tradeableOn(items, active)), why: cat === "all" ? explainNoConfirmed(items, active) : null };
}

/** Items a given exchange user can actually place: listed there, and no SHORTs on spot-only venues. */
export function tradeableOn(items: Opportunity[], venue: VenueId): Opportunity[] {
  return items.filter((i) => i.category === "speculative" || i.category === "spot" || (i.venues.includes(venue) && (VENUE_META[venue].canShort || i.side !== "SHORT")));
}

async function verifyConfirmed(items: Opportunity[], sb: SupabaseClient, budgetMs: number): Promise<number> {
  const started = Date.now();
  const targets = items.filter((i) => i.category === "confirmed" && i.assetKey.startsWith("cg:") && Date.now() - Date.parse(i.updatedAt) > 10 * 60_000);
  let demoted = 0;
  await Promise.all(targets.slice(0, 40).map(async (i) => {
    if (Date.now() - started > budgetMs) return;
    const tf = i.timeframe as Timeframe;
    const d: any = i.detail ?? {};
    if (!d.setup) return;
    const r = await safe(getOhlcv({ symbol: i.symbol, coingeckoId: i.assetKey.slice(3) }, tf, SCREEN_CANDLES));
    if (!r.ok || r.data.quality !== "verified") return;
    const a = analyzeTimeframe(tf, r.data.candles);
    if (!a) return;
    // Same rule as the screener: the signal stands until its stop, TP1, a faded score, a flip or old age ends it.
    const res = holdCheck({ a, candles: r.data.candles, setup: d.setup, since: i.firstSeen, tf });
    if (res.held) { i.price = a.price; return; }
    demoted++;
    const out = await demoteRow(sb, { asset_key: i.assetKey, symbol: i.symbol, timeframe: tf, detail: d }, a, res);
    i.category = out.category; i.detail = out.detail; i.firstSeen = out.at; i.updatedAt = out.at;
  }));
  return demoted;
}

export function counts(items: Opportunity[]) {
  return { confirmed: items.filter((i) => i.category === "confirmed").length, watching: items.filter((i) => i.category === "watching").length, speculative: items.filter((i) => i.category === "speculative").length, spot: items.filter((i) => i.category === "spot").length };
}
