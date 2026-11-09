import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { buildTrackRecord } from "@/lib/track-record";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Public engine track record; adds the caller's own journal record when signed in. */
export async function GET() {
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "no database" }, { status: 501 });
  const sb = await supabaseServer();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  return NextResponse.json(await buildTrackRecord(admin, user?.id ?? null));
}
