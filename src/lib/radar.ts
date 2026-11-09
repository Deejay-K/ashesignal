// Stage 37 - Holdings Radar: what the engine currently says about each coin the user actually holds, and one plain
// action per coin. Built from the latest holdings snapshot (wallets + read-only exchange accounts) and the screener's
// rows, so it is cheap enough for the website and the Telegram bot. Nothing here places orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtUsd } from "./format";
import { VENUE_META, type VenueId } from "./venues";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STABLES = new Set(["USDC", "USDT", "DAI", "USD", "BUSD", "TUSD", "FDUSD", "PYUSD", "USDE", "EUR", "CAD", "GBP", "EURC", "USDS"]);

export type RadarTone = "up" | "down" | "amber" | "muted";
export interface RadarRow {
  symbol: string; name: string | null; coingeckoId: string | null; amount: number; valueUsd: number; pct: number;
  price: number | null; change24h: number | null;
  views: { tf: string; outlook: string | null; score: number | null; category: string | null; side: string | null; kind: string | null; entry?: { low: number; high: number } | null; stop?: number | null; tp1?: number | null }[];
  spot: { tier: string | null; score: number | null; zone: { low: number; high: number } | null; inZone: boolean; nextTake: { label: string; price: number } | null } | null;
  action: string; tone: RadarTone; flags: string[];
}
export interface Radar { totalUsd: number; takenAt: string | null; rows: RadarRow[]; unscreened: { symbol: string; valueUsd: number }[]; stableUsd: number; summary: string; note?: string }

export async function buildRadar(sb: SupabaseClient, userId: string, venue: VenueId): Promise<Radar> {
  const { data: snap } = await sb.from("holdings_snapshots").select("taken_at, total_usd, holdings").eq("user_id", userId).order("taken_at", { ascending: false }).limit(1).maybeSingle();
  if (!snap) return { totalUsd: 0, takenAt: null, rows: [], unscreened: [], stableUsd: 0, summary: "No holdings yet.", note: "Connect a wallet or a read-only exchange key on the Portfolio page. The radar reads the latest daily snapshot; press Refresh to take one now." };
  // Merge the same coin across wallets and exchanges.
  const merged = new Map<string, { symbol: string; amount: number; valueUsd: number }>();
  for (const h of (snap.holdings ?? []) as any[]) {
    const sym = String(h.symbol ?? "").toUpperCase();
    if (!sym || !(Number(h.value_usd) >= 1)) continue;
    const m = merged.get(sym) ?? { symbol: sym, amount: 0, valueUsd: 0 };
    m.amount += Number(h.amount) || 0; m.valueUsd += Number(h.value_usd) || 0;
    merged.set(sym, m);
  }
  const all = [...merged.values()];
  const stableUsd = all.filter((h) => STABLES.has(h.symbol)).reduce((s, h) => s + h.valueUsd, 0);
  const coins = all.filter((h) => !STABLES.has(h.symbol)).sort((a, b) => b.valueUsd - a.valueUsd);
  const total = all.reduce((s, h) => s + h.valueUsd, 0);
  const symbols = coins.map((c) => c.symbol);
  const [{ data: metrics }, { data: spots }] = symbols.length ? await Promise.all([
    sb.from("coin_metrics").select("asset_key, symbol, name, timeframe, price, market_cap, change_24h_pct, outlook, score, category, setup_side, setup_kind, detail").in("symbol", symbols).in("timeframe", ["4h", "1d"]),
    sb.from("spot_picks").select("asset_key, symbol, tier, spot_score, price, detail").in("symbol", symbols),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }];
  const rows: RadarRow[] = []; const unscreened: Radar["unscreened"] = [];
  const canShort = VENUE_META[venue].canShort;
  for (const h of coins) {
    const ms = (metrics ?? []).filter((m) => String(m.symbol).toUpperCase() === h.symbol);
    if (!ms.length) { unscreened.push({ symbol: h.symbol, valueUsd: h.valueUsd }); continue; }
    // Same ticker on two coins: keep the bigger market cap.
    const key = ms.sort((a, b) => Number(b.market_cap ?? 0) - Number(a.market_cap ?? 0))[0].asset_key;
    const mine = ms.filter((m) => m.asset_key === key);
    const sp = (spots ?? []).find((s) => s.asset_key === key) ?? null;
    const any0 = mine[0];
    const price = Number(any0.price) || null;
    const views = ["4h", "1d"].map((tf) => {
      const m = mine.find((x) => x.timeframe === tf);
      const st = m?.detail?.setup;
      return { tf, outlook: m?.outlook ?? null, score: m?.score ?? null, category: m?.category ?? null, side: st?.side ?? m?.setup_side ?? null, kind: m?.category === "confirmed" ? "confirmed" : m?.setup_kind ?? null, entry: st?.entry ?? null, stop: st?.stopLosses?.[0]?.price ?? null, tp1: st?.takeProfits?.[0]?.price ?? null };
    });
    const zone = sp?.detail?.analysis?.accumulation ?? null;
    const takes: { label: string; price: number }[] = sp?.detail?.analysis?.profitTaking ?? [];
    const nextTake = price ? takes.filter((t) => t.price > price).sort((a, b) => a.price - b.price)[0] ?? null : null;
    const spot = sp ? { tier: sp.tier ?? null, score: sp.spot_score ?? null, zone, inZone: !!(zone && price && price >= zone.low && price <= zone.high), nextTake } : null;
    const pct = total ? (h.valueUsd / total) * 100 : 0;
    const flags: string[] = [];
    if (pct >= 40) flags.push(`${pct.toFixed(0)}% of your portfolio in one coin`);
    const confShort = views.find((v) => v.category === "confirmed" && v.side === "SHORT");
    const confLong = views.find((v) => v.category === "confirmed" && v.side === "LONG");
    const d1 = views.find((v) => v.tf === "1d");
    let action = "Hold. No new signal; nothing to do.", tone: RadarTone = "muted";
    if (confShort) { action = `Confirmed SHORT on ${confShort.tf}: ${canShort ? "a short setup exists, and" : "on a spot account"} this is the engine's sell signal. Consider trimming, and if you keep it, protect it with a stop under the last swing low.${confShort.stop ? ` The bearish idea is wrong if price closes above ${fmtUsd(confShort.stop)}.` : ""}`; tone = "down"; }
    else if (d1?.score != null && d1.score <= -35) { action = `Daily trend is bearish (score ${d1.score}). Decide your exit level now and protect profits; avoid adding.`; tone = "down"; }
    else if (spot?.nextTake && price && spot.nextTake.price <= price * 1.03) { action = `Near a profit-taking zone (${spot.nextTake.label} ${fmtUsd(spot.nextTake.price)}). Consider selling a slice there.`; tone = "amber"; }
    else if (confLong) { action = `Confirmed LONG on ${confLong.tf}. Adding is within the rules if price is in the entry zone${confLong.entry ? ` (${fmtUsd(confLong.entry.low)} to ${fmtUsd(confLong.entry.high)})` : ""}, sized by the stop.`; tone = "up"; }
    else if (spot?.inZone) { action = `In its accumulation zone (${fmtUsd(zone!.low)} to ${fmtUsd(zone!.high)}). Fine to keep building slowly with a DCA plan.`; tone = "up"; }
    else if (d1?.score != null && d1.score >= 35) { action = `Daily trend is bullish (score +${d1.score}). Let it run; trail your stop rather than taking profit early.`; tone = "up"; }
    else if (views.some((v) => v.category === "watching")) { action = `Watching: structure is building on ${views.filter((v) => v.category === "watching").map((v) => v.tf).join(" and ")}. No action until it confirms.`; tone = "amber"; }
    rows.push({ symbol: h.symbol, name: any0.name ?? null, coingeckoId: String(key).startsWith("cg:") ? String(key).slice(3) : null, amount: h.amount, valueUsd: h.valueUsd, pct, price, change24h: any0.change_24h_pct ?? null, views, spot, action, tone, flags });
  }
  const sells = rows.filter((r) => r.tone === "down").length, ups = rows.filter((r) => r.tone === "up").length;
  const summary = rows.length ? `${rows.length} coin${rows.length === 1 ? "" : "s"} screened: ${sells} with a sell or protect signal, ${ups} with a positive signal, ${rows.length - sells - ups} neutral.${stableUsd ? ` ${fmtUsd(stableUsd)} in stablecoins.` : ""}` : "None of your coins is covered by the screener yet.";
  return { totalUsd: total, takenAt: snap.taken_at, rows, unscreened, stableUsd, summary };
}
