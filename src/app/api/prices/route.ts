import { NextRequest, NextResponse } from "next/server";
import { priceBoard } from "@/lib/market/prices";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  return NextResponse.json(await priceBoard(symbol, venueFromRequest(req)));
}
