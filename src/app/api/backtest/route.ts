import { NextRequest, NextResponse } from "next/server";
import { getOhlcv } from "@/lib/market/ohlcv";
import { backtest } from "@/lib/ta/backtest";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { at: number; v: unknown }>();

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tf = (sp.get("tf") ?? "4h") as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "bad timeframe" }, { status: 400 });
  const ref = { symbol: sp.get("symbol") ?? undefined, coingeckoId: sp.get("id") ?? undefined, pool: sp.get("network") && sp.get("pool") ? { network: sp.get("network")!, address: sp.get("pool")! } : undefined };
  const key = JSON.stringify([ref, tf]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return NextResponse.json({ ...(hit.v as object), cached: true });
  const o = await getOhlcv(ref, tf, 1000);
  if (o.candles.length < 200) return NextResponse.json({ error: `Need at least 200 candles on ${tf}; have ${o.candles.length}.` }, { status: 422 });
  const r = backtest(tf, o.candles);
  const v = { ...r, source: o.source, quality: o.quality };
  cache.set(key, { at: Date.now(), v });
  return NextResponse.json(v);
}
