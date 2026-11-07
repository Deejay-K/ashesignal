import { NextRequest, NextResponse } from "next/server";
import { discover } from "@/lib/market/discover";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await discover(venueFromRequest(req)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
