import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets } from "@/lib/providers/coingecko";
import { getKlines, getTradingSymbols } from "@/lib/providers/binance";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TFS: Timeframe[] = ["1h", "4h", "1d"];

/** Keeps coin_metrics fresh for the top 100 Binance-listed coins: 10 coins per call, 10 rotating batches. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const top = await safe(getMarkets(1, 150, false));
  if (!top.ok) return NextResponse.json({ error: top.error }, { status: 502 });
  let syms: Set<string>;
  try { syms = await getTradingSymbols(); } catch (e) { return NextResponse.json({ error: "binance: " + (e as Error).message }, { status: 502 }); }
  const coins = top.data.filter((c) => syms.has(`${c.symbol}USDT`)).slice(0, 100);
  const url = new URL(req.url);
  const BATCH = 10;
  const batches = Math.ceil(coins.length / BATCH);
  const batch = url.searchParams.get("batch") != null ? Number(url.searchParams.get("batch")) % batches : Math.floor(new Date().getMinutes() / 5) % batches;
  const slice = coins.slice(batch * BATCH, batch * BATCH + BATCH);
  const rows: Record<string, unknown>[] = [];
  await Promise.all(slice.map(async (c) => {
    const ks = await Promise.all(TFS.map((tf) => safe(getKlines(`${c.symbol}USDT`, tf, 300))));
    ks.forEach((k, i) => {
      if (!k.ok) return;
      const a = analyzeTimeframe(TFS[i], k.data);
      if (!a) return;
      rows.push({ asset_key: `cg:${c.id}`, symbol: c.symbol, name: c.name, timeframe: TFS[i], price: a.price, market_cap: c.marketCapUsd, volume_24h: c.volume24hUsd, change_24h_pct: c.change24hPct, score: a.score, outlook: a.outlook, opportunity: a.opportunityScore, rsi: a.momentum.rsi, atr_pct: a.volatility.atrPct * 100, vol_ratio: a.volume.ratio, vol_regime: a.volatility.regime, trend: a.trend.direction, macd_cross: a.momentum.macdCross, breakout: a.breakout.type, setup_side: a.setup?.side ?? null, setup_kind: a.setup?.kind ?? null, setup_rr: a.setup?.riskRewardTp2 ?? null, setup_confidence: a.setup?.confidence ?? null, leverage: a.setup?.leverage.recommended ?? null, patterns: [...a.patterns.confirmed, ...a.patterns.forming].slice(0, 4).map((p) => `${p.name} (${p.status})`), updated_at: new Date().toISOString() });
    });
  }));
  if (rows.length) {
    const { error } = await sb.from("coin_metrics").upsert(rows, { onConflict: "asset_key,timeframe" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, batch: `${batch + 1}/${batches}`, coins: slice.map((c) => c.symbol), rows: rows.length, at: new Date().toISOString() });
}
