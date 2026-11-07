import { NextRequest, NextResponse } from "next/server";
import { globalConditions, assetConditions, summarize } from "@/lib/market/conditions";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { priceBoard } from "@/lib/market/prices";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";

/** GET /api/conditions[?symbol=&id=&network=&pool=&tf=&liquidity=] - global + asset trade conditions. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const g = await globalConditions();
  const tf = sp.get("tf") as Timeframe | null;
  let asset: ReturnType<typeof assetConditions> = [];
  if (tf && TIMEFRAMES.includes(tf) && (sp.get("symbol") || sp.get("id") || sp.get("pool"))) {
    const ref = { symbol: sp.get("symbol") ?? undefined, coingeckoId: sp.get("id") ?? undefined, pool: sp.get("network") && sp.get("pool") ? { network: sp.get("network")!, address: sp.get("pool")! } : undefined };
    const [o, pb] = await Promise.all([getOhlcv(ref, tf, 300), ref.symbol && !ref.pool ? safe(priceBoard(ref.symbol)) : Promise.resolve(null)]);
    const a = o.candles.length ? analyzeTimeframe(tf, o.candles) : null;
    const liq = sp.get("liquidity") ? Number(sp.get("liquidity")) : null;
    asset = assetConditions(a, { liquidityUsd: liq, spreadPct: pb && pb.ok ? pb.data.spreadPct : null, isDex: !!ref.pool });
  }
  const conditions = [...asset, ...g.conditions];
  return NextResponse.json({ ...summarize(conditions), conditions, events: g.events, source: g.source, generatedAt: Date.now() });
}
