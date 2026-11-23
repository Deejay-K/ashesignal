import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { runWatchdog } from "@/lib/watchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Daily from Vercel (the fallback when GitHub Actions is down); ?force=1 checks now even if checked recently. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  return NextResponse.json({ ok: true, ...(await runWatchdog(sb, { force })), at: new Date().toISOString() });
}
