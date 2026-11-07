// Alert evaluation. Each alert has a type + params + an evaluation state that
// prevents re-firing on every run (edge-triggered, with a cooldown).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOhlcv, type AssetRef } from "@/lib/market/ohlcv";
import { analyzeTimeframe, type TimeframeAnalysis } from "@/lib/ta/analysis";
import { getFearGreed } from "@/lib/providers/feargreed";
import type { Timeframe } from "@/lib/types";
import { deliver } from "./notify";
import { liquidityChanges } from "@/lib/market/liquidity";
import { detectNewListings, type NewListing } from "@/lib/market/listings";
import { globalConditions } from "@/lib/market/conditions";
import { fmtUsd } from "@/lib/format";

import { type AlertType } from "./types";

interface AlertRow {
  id: string;
  user_id: string;
  asset_key: string;
  symbol: string;
  type: AlertType;
  timeframe: string | null;
  params: Record<string, number | string>;
  asset_ref: AssetRef & { id?: string };
  state: Record<string, unknown>;
  last_fired_at: string | null;
  cooldown_minutes: number;
  active: boolean;
}

function refOf(a: AlertRow): AssetRef {
  const r = a.asset_ref ?? {};
  return { symbol: r.symbol ?? a.symbol, coingeckoId: r.coingeckoId ?? r.id, pool: r.pool };
}

export async function evaluateAlerts(sb: SupabaseClient) {
  const { data, error } = await sb.from("alerts").select("*").eq("active", true).limit(500);
  if (error) throw new Error(error.message);
  const alerts = (data ?? []) as AlertRow[];
  const analysisCache = new Map<string, TimeframeAnalysis | null>();
  let fired = 0;
  let evaluated = 0;
  let fng: { value: number; label: string } | null = null;
  let liq: Awaited<ReturnType<typeof liquidityChanges>> | null = null;
  let listings: NewListing[] | null = null;

  for (const a of alerts) {
    evaluated++;
    if (a.last_fired_at && Date.now() - new Date(a.last_fired_at).getTime() < (a.cooldown_minutes ?? 60) * 60_000) continue;
    const tf = (a.timeframe ?? "1h") as Timeframe;
    let msg: { title: string; body: string } | null = null;
    const newState: Record<string, unknown> = { ...a.state };

    if (a.type === "macro_event") {
      const g = await globalConditions();
      const soon = g.events.filter((e) => e.impact === "High" && Date.parse(e.time) - Date.now() > 0 && Date.parse(e.time) - Date.now() <= 2 * 3_600_000);
      const sig = soon.map((e) => e.time).join(",");
      if (soon.length && sig !== a.state.lastMacro) msg = { title: `Macro event in ${Math.round((Date.parse(soon[0].time) - Date.now()) / 60_000)} min: ${soon[0].title}`, body: `${soon.map((e) => `${e.title} at ${new Date(e.time).toLocaleTimeString()}`).join("; ")}. High volatility window - avoid new positions and tighten management.` };
      if (sig) newState.lastMacro = sig;
    } else if (a.type === "new_listing") {
      if (!listings) listings = (await detectNewListings(sb)).fresh;
      const chainFilter = a.params.chain ? String(a.params.chain) : null;
      const mine = listings.filter((l) => !chainFilter || l.chain === chainFilter).slice(0, 10);
      if (mine.length) msg = { title: `${mine.length} new listing${mine.length > 1 ? "s" : ""}`, body: mine.map((l) => `${l.symbol} (${l.chain}, ${l.source})`).join(", ") };
    } else if (a.type === "liquidity_change") {
      if (!liq) liq = await liquidityChanges(sb, 24, 5_000, 1);
      const addr = (a.asset_ref as { address?: string } | null)?.address?.toLowerCase();
      const hit = liq.find((c) => addr && c.tokenAddress?.toLowerCase() === addr && Math.abs(c.changePct) >= Number(a.params.pct ?? 30));
      const sig = hit ? `${hit.pool}@${Math.round(hit.changePct)}` : null;
      if (hit && sig !== a.state.lastLiq) msg = { title: `${a.symbol} liquidity ${hit.changePct > 0 ? "+" : ""}${hit.changePct.toFixed(0)}% in ~${hit.hours.toFixed(0)}h`, body: `${fmtUsd(hit.liquidityBefore, { compact: true })} → ${fmtUsd(hit.liquidityNow, { compact: true })} on ${hit.chain}.${hit.changePct < -50 ? " Large liquidity removal - possible rug." : ""}` };
      if (sig) newState.lastLiq = sig;
    } else if (a.type === "sentiment_zone") {
      if (!fng) {
        const h = await getFearGreed(1);
        fng = h[h.length - 1] ?? null;
      }
      if (fng && fng.label === a.params.zone && a.state.lastZone !== fng.label) msg = { title: `Fear & Greed: ${fng.label}`, body: `Index is ${fng.value} (${fng.label}).` };
      if (fng) newState.lastZone = fng.label;
    } else {
      const key = `${a.asset_key}|${tf}`;
      let an = analysisCache.get(key);
      if (an === undefined) {
        const o = await getOhlcv(refOf(a), tf, 300);
        an = o.candles.length ? analyzeTimeframe(tf, o.candles) : null;
        if (!an && o.candles.length) {
          // too few candles for full analysis - still allow price alerts
          const c = o.candles[o.candles.length - 1];
          an = { price: c.close, momentum: { rsi: NaN, macdCross: null }, volume: { ratio: NaN }, breakout: { type: null, level: null, note: "" }, patterns: { completed: [] }, timeframe: tf } as unknown as TimeframeAnalysis;
        }
        analysisCache.set(key, an);
      }
      if (!an) continue;
      const p = an.price;
      const prev = typeof a.state.lastPrice === "number" ? (a.state.lastPrice as number) : null;
      newState.lastPrice = p;
      const target = Number(a.params.price);
      switch (a.type) {
        case "price_above":
        case "tp":
          if (p >= target && (prev == null || prev < target)) msg = { title: `${a.symbol} ${a.type === "tp" ? "hit take-profit" : "above"} ${fmtUsd(target)}`, body: `Price ${fmtUsd(p)} on ${tf}.` };
          break;
        case "price_below":
        case "sl":
          if (p <= target && (prev == null || prev > target)) msg = { title: `${a.symbol} ${a.type === "sl" ? "hit stop-loss" : "below"} ${fmtUsd(target)}`, body: `Price ${fmtUsd(p)} on ${tf}.` };
          break;
        case "pct_move": {
          const bars = Number(a.params.bars ?? 24);
          const ref = (a.state.refPrice as number | undefined) ?? p;
          const refAt = (a.state.refAt as number | undefined) ?? Date.now();
          const pct = ((p - ref) / ref) * 100;
          if (Math.abs(pct) >= Number(a.params.pct)) {
            msg = { title: `${a.symbol} moved ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, body: `From ${fmtUsd(ref)} to ${fmtUsd(p)} (${tf} window).` };
            newState.refPrice = p;
            newState.refAt = Date.now();
          } else if (Date.now() - refAt > bars * 3_600_000) {
            newState.refPrice = p;
            newState.refAt = Date.now();
          } else if (a.state.refPrice == null) {
            newState.refPrice = p;
            newState.refAt = Date.now();
          }
          break;
        }
        case "rsi_above":
          if (an.momentum.rsi >= Number(a.params.rsi) && a.state.rsiState !== "above") msg = { title: `${a.symbol} RSI ${an.momentum.rsi.toFixed(0)} on ${tf}`, body: `Crossed above ${a.params.rsi}.` };
          newState.rsiState = an.momentum.rsi >= Number(a.params.rsi) ? "above" : "below";
          break;
        case "rsi_below":
          if (an.momentum.rsi <= Number(a.params.rsi) && a.state.rsiState !== "below") msg = { title: `${a.symbol} RSI ${an.momentum.rsi.toFixed(0)} on ${tf}`, body: `Crossed below ${a.params.rsi}.` };
          newState.rsiState = an.momentum.rsi <= Number(a.params.rsi) ? "below" : "above";
          break;
        case "macd_cross":
          if (an.momentum.macdCross && a.state.lastCross !== an.momentum.macdCross) msg = { title: `${a.symbol} MACD ${an.momentum.macdCross} cross (${tf})`, body: `Histogram ${an.momentum.macdHist.toFixed(4)}; score ${an.score}.` };
          if (an.momentum.macdCross) newState.lastCross = an.momentum.macdCross;
          break;
        case "pattern": {
          const latest = an.patterns.completed[0];
          const sig = latest ? `${latest.name}@${latest.endTime}` : null;
          if (latest && sig !== a.state.lastPattern) msg = { title: `${a.symbol}: ${latest.name} completed (${tf})`, body: latest.description };
          if (sig) newState.lastPattern = sig;
          break;
        }
        case "breakout":
        case "breakdown": {
          const sig = an.breakout.type ? `${an.breakout.type}@${an.breakout.level}` : null;
          if (an.breakout.type === a.type && sig !== a.state.lastBreak) msg = { title: `${a.symbol} ${a.type} on ${tf}`, body: an.breakout.note };
          if (sig) newState.lastBreak = sig;
          break;
        }
        case "volume_spike":
          if (an.volume.ratio >= Number(a.params.ratio ?? 2) && a.state.volState !== "high") msg = { title: `${a.symbol} volume ${an.volume.ratio.toFixed(1)}× average (${tf})`, body: an.volume.note };
          newState.volState = an.volume.ratio >= Number(a.params.ratio ?? 2) ? "high" : "normal";
          break;
      }
    }

    const patch: Record<string, unknown> = { state: newState };
    if (msg) {
      fired++;
      patch.last_fired_at = new Date().toISOString();
      const url = a.asset_key.startsWith("cg:") ? `/token/${a.asset_key.slice(3)}` : "/alerts";
      await deliver(sb, { userId: a.user_id, alertId: a.id, symbol: a.symbol, title: msg.title, body: msg.body, url });
    }
    await sb.from("alerts").update(patch).eq("id", a.id);
  }
  return { evaluated, fired };
}
