import { NextRequest, NextResponse } from "next/server";
import { getOhlcv } from "@/lib/market/ohlcv";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tf = (sp.get("tf") ?? "1h") as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "bad timeframe" }, { status: 400 });
  const ref = {
    symbol: sp.get("symbol") ?? undefined,
    coingeckoId: sp.get("id") ?? undefined,
    pool: sp.get("network") && sp.get("pool") ? { network: sp.get("network")!, address: sp.get("pool")! } : undefined,
  };
  const limit = Math.min(1000, Number(sp.get("limit") ?? 500));
  return NextResponse.json(await getOhlcv(ref, tf, limit));
}
