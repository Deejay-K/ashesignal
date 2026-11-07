import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { resolveTable } from "@/lib/alerts/resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Resolves open saved setups and logged signals against live 15m candles. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  try {
    const [saved, signals] = await Promise.all([resolveTable(sb, "saved_setups"), resolveTable(sb, "signal_log")]);
    return NextResponse.json({ ok: true, saved, signals, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
