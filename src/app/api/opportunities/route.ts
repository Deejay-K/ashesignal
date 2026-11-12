import { NextRequest, NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { venueFromRequest } from "@/lib/venue-pref";
import { loadDiscovery, loadDiscoveryCached, clearDiscoveryCache } from "@/lib/market/discovery";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Trading Discovery for the website. The Telegram bot uses the same loadDiscovery(), so both always agree. */
export async function GET(req: NextRequest) {
  await ensureEngineConfig();
  const sb = supabaseAdmin();
  const cat = req.nextUrl.searchParams.get("cat") ?? "all";
  const venue = venueFromRequest(req);
  // "Refresh live" always recomputes (and clears the memo); normal page loads share one result for 30 seconds.
  const live = req.nextUrl.searchParams.get("live") === "1";
  if (live) clearDiscoveryCache();
  const r = live ? await loadDiscovery(sb, { cat, venue, live: true }) : await loadDiscoveryCached(sb, { cat, venue });
  return NextResponse.json(r);
}
