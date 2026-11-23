import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { settleOpen } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 5 minutes: grades finished signals from candles and writes each outcome once. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  try {
    return NextResponse.json({ ok: true, ...(await settleOpen(sb, 40_000)), at: new Date().toISOString() });
  } catch (e) {
    console.error(`[ledger] settle failed: ${(e as Error).message}`);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
