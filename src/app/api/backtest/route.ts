import { NextRequest, NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { getOhlcv } from "@/lib/market/ohlcv";
import { backtest } from "@/lib/ta/backtest";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { at: number; v: unknown }>();

export async function GET(req: NextRequest) {
  await ensureEngineConfig();
  const sp = req.nextUrl.searchParams;
  const tf = (sp.get("tf") ?? "4h") as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "bad timeframe" }, { status: 400 });
  const ref = { symbol: sp.get("symbol") ?? undefined, coingeckoId: sp.get("id") ?? undefined, pool: sp.get("network") && sp.get("pool") ? { network: sp.get("network")!, address: sp.get("pool")! } : undefined };
  // Rule tester: optional gate overrides and filters (see /lab for the same variants across many charts)
  const num = (k: string) => { const v = Number(sp.get(k)); return sp.get(k) != null && Number.isFinite(v) ? v : undefined; };
  const gates = { band: num("band"), volMin: num("volMin"), stretchMax: num("stretchMax"), tp1Min: num("tp1Min"), tp2Min: num("tp2Min") };
  const onlyConfirmed = sp.get("onlyConfirmed") === "1";
  const htfFilter = sp.get("htf") === "1";
  const custom = Object.values(gates).some((v) => v != null) || onlyConfirmed || htfFilter;
  const key = JSON.stringify([ref, tf, gates, onlyConfirmed, htfFilter]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return NextResponse.json({ ...(hit.v as object), cached: true });
  const o = await getOhlcv(ref, tf, 1000);
  if (o.candles.length < 200) return NextResponse.json({ error: `Need at least 200 candles on ${tf}; have ${o.candles.length}.` }, { status: 422 });
  const r = backtest(tf, o.candles, custom ? { gates: Object.fromEntries(Object.entries(gates).filter(([, v]) => v != null)), onlyConfirmed, htfFilter } : {});
  const v = { ...r, source: o.source, quality: o.quality };
  cache.set(key, { at: Date.now(), v });
  return NextResponse.json(v);
}
