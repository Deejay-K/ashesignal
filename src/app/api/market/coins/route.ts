import { NextRequest, NextResponse } from "next/server";
import { getMarkets, getMarketsByIds } from "@/lib/providers/coingecko";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ids = sp.get("ids");
  const page = Number(sp.get("page") ?? 1);
  const perPage = Math.min(250, Number(sp.get("perPage") ?? 100));
  const r = await safe(ids ? getMarketsByIds(ids.split(",").filter(Boolean)) : getMarkets(page, perPage, true));
  if (!r.ok) return NextResponse.json({ error: r.error, coins: [] }, { status: 502 });
  return NextResponse.json({ coins: r.data, source: "coingecko", fetchedAt: Date.now() });
}
