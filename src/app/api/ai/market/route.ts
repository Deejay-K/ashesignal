import { NextRequest, NextResponse } from "next/server";
import { buildMarketBriefing } from "@/lib/ai/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await buildMarketBriefing(req.nextUrl.searchParams.get("force") === "1"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
