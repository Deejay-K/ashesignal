import { NextRequest, NextResponse } from "next/server";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { analyzeAsset } from "@/lib/market/analyze";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";

/** ?symbol=SOL&id=solana[&tf=1h] - single timeframe when tf given, else multi-timeframe consensus. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ref = {
    symbol: sp.get("symbol") ?? undefined,
    coingeckoId: sp.get("id") ?? undefined,
    pool: sp.get("network") && sp.get("pool") ? { network: sp.get("network")!, address: sp.get("pool")! } : undefined,
    venue: venueFromRequest(req),
  };
  const tf = sp.get("tf") as Timeframe | null;
  if (tf) {
    if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "bad timeframe" }, { status: 400 });
    const o = await getOhlcv(ref, tf, 500);
    const a = o.candles.length ? analyzeTimeframe(tf, o.candles) : null;
    return NextResponse.json({ source: o.source, symbol: o.symbol, quality: o.quality, note: o.note, analysis: a, candles: o.candles.length });
  }
  const tfs = sp.get("tfs")?.split(",").filter((t): t is Timeframe => TIMEFRAMES.includes(t as Timeframe));
  return NextResponse.json(await analyzeAsset(ref, tfs?.length ? tfs : undefined));
}
