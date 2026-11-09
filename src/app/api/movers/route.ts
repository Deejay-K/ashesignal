import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildMovers } from "@/lib/movers";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return NextResponse.json(await buildMovers(supabaseAdmin(), venueFromRequest(req)));
}
