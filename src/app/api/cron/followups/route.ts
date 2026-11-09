import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { runFollowups } from "@/lib/followups";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 5 minutes: lifecycle messages (zone, TP1, TP2, TP3, SL, lost confirmation) for broadcast Confirmed trades. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  try { return NextResponse.json({ ok: true, ...(await runFollowups(sb)), at: new Date().toISOString() }); }
  catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }); }
}
