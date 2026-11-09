import { NextRequest, NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { venueFromRequest } from "@/lib/venue-pref";
import { buildPlan } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await ensureEngineConfig();
  const admin = supabaseAdmin();
  const sb = await supabaseServer();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  const plan = await buildPlan(admin, user?.id ?? null, venueFromRequest(req));
  return NextResponse.json({ ...plan, signedIn: !!user });
}
