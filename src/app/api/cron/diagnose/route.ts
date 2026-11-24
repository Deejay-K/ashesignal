import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { diagnose } from "@/lib/diagnose";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Open in a browser: /api/cron/diagnose?secret=YOUR_CRON_SECRET
 * Read-only check of the whole signal pipeline with a plain-language verdict. Never shows secrets.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized: add ?secret=YOUR_CRON_SECRET" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ verdict: ["SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set in Vercel."] }, { status: 501 });
  try { return NextResponse.json(await diagnose(sb), { headers: { "cache-control": "no-store" } }); }
  catch (e) { return NextResponse.json({ verdict: [`Diagnosis failed: ${(e as Error).message}`] }, { status: 500 }); }
}
