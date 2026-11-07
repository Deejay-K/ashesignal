import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/providers/coingecko";
import { searchPairs } from "@/lib/providers/dexscreener";
import { classifyAddress } from "@/lib/providers/chains";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ coins: [], pairs: [], isAddress: false });
  const isAddress = classifyAddress(q) !== "unknown";
  const [c, d] = await Promise.all([isAddress ? Promise.resolve({ ok: true as const, data: [] }) : safe(search(q)), safe(searchPairs(q))]);
  return NextResponse.json({
    isAddress,
    coins: c.ok ? c.data : [],
    pairs: d.ok ? d.data.slice(0, 10).map((p) => ({ chainId: p.chainId, dexId: p.dexId, pairAddress: p.pairAddress, base: p.baseToken, quote: p.quoteToken.symbol, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24h: p.volume.h24 })) : [],
  });
}
