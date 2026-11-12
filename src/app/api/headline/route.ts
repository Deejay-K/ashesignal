import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { venueFromRequest } from "@/lib/venue-pref";
import { buildHeadline } from "@/lib/headline";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The one sentence at the top of the dashboard: where the market is, and what that means for you today. */
export async function GET(req: NextRequest) {
  return NextResponse.json(await buildHeadline(supabaseAdmin(), venueFromRequest(req)));
}
