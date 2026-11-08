import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets } from "@/lib/providers/coingecko";
import { getOhlcv } from "@/lib/market/ohlcv";
import { backtest } from "@/lib/ta/backtest";
import { LAB_VARIANTS } from "@/lib/ta/lab";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TFS: Timeframe[] = ["1h", "4h", "1d"];
const EXCL = /^(USDT|USDC|DAI|FDUSD|TUSD|PYUSD|USDE|USDS|WBTC|WETH|STETH|WSTETH|CBBTC|RETH|WEETH|WBETH|XAUT|PAXG|USD1|RLUSD)$/i;

/**
 * Engine Lab worker: backtests every rule variant on the stalest coin/timeframes (top 40 by market cap),
 * 45 s budget per call, results upserted into engine_lab. One full pass takes a few hours; rows older
 * than 48 h are refreshed first.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const started = Date.now();
  const BUDGET = Number(new URL(req.url).searchParams.get("budget") ?? 45_000);
  const top = await safe(getMarkets(1, 60, false));
  if (!top.ok) return NextResponse.json({ error: top.error }, { status: 502 });
  const coins = top.data.filter((c) => !EXCL.test(c.symbol)).slice(0, 40);
  const { data: fresh } = await sb.from("engine_lab").select("asset_key, timeframe").eq("variant", "production").gt("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString());
  const done = new Set((fresh ?? []).map((r) => `${r.asset_key}|${r.timeframe}`));
  const queue: { id: string; symbol: string; tf: Timeframe }[] = [];
  for (const c of coins) for (const tf of TFS) if (!done.has(`cg:${c.id}|${tf}`)) queue.push({ id: c.id, symbol: c.symbol, tf });
  let processed = 0;
  const rows: Record<string, unknown>[] = [];
  for (const q of queue) {
    if (Date.now() - started > BUDGET - 12_000) break;
    const r = await safe(getOhlcv({ symbol: q.symbol, coingeckoId: q.id }, q.tf, 500));
    if (!r.ok || r.data.quality !== "verified" || r.data.candles.length < 200) continue;
    processed++;
    for (const v of LAB_VARIANTS) {
      const b = backtest(q.tf, r.data.candles, { ...v.opts, step: 4, minHistory: 150, maxHold: 40 });
      rows.push({ asset_key: `cg:${q.id}`, symbol: q.symbol, timeframe: q.tf, variant: v.id, candles: b.candles, signals: b.signals, filled: b.filled, wins: b.wins, losses: b.losses, expired: b.expired, win_rate: b.winRate, expectancy_r: b.expectancyR, profit_factor: b.profitFactor, max_dd_r: b.maxDrawdownR, updated_at: new Date().toISOString() });
    }
  }
  if (rows.length) { const { error } = await sb.from("engine_lab").upsert(rows, { onConflict: "asset_key,timeframe,variant" }); if (error) return NextResponse.json({ error: error.message }, { status: 500 }); }
  return NextResponse.json({ ok: true, processed, remaining: queue.length - processed, variants: LAB_VARIANTS.length, seconds: Math.round((Date.now() - started) / 1000) });
}
