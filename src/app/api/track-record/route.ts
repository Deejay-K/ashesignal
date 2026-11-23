import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { buildTrackRecord } from "@/lib/track-record";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
let memo: { at: number; data: unknown } | null = null;

/** Public engine track record; adds the caller's own journal record when signed in. */
export async function GET() {
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "no database" }, { status: 501 });
  const sb = await supabaseServer();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  // Signed-out visitors (every dashboard load) share one copy for a minute; signed-in members get their own journal.
  if (!user && memo && Date.now() - memo.at < 60_000) return NextResponse.json(memo.data);
  const data = await buildTrackRecord(admin, user?.id ?? null);
  if (!user) memo = { at: Date.now(), data };
  return NextResponse.json(data);
}
