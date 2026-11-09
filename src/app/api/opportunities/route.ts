import { NextRequest, NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { venueFromRequest } from "@/lib/venue-pref";
import { loadDiscovery } from "@/lib/market/discovery";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Trading Discovery for the website. The Telegram bot uses the same loadDiscovery(), so both always agree. */
export async function GET(req: NextRequest) {
  await ensureEngineConfig();
  const sb = supabaseAdmin();
  const cat = req.nextUrl.searchParams.get("cat") ?? "all";
  const r = await loadDiscovery(sb, { cat, venue: venueFromRequest(req), live: req.nextUrl.searchParams.get("live") === "1" });
  return NextResponse.json(r);
}
