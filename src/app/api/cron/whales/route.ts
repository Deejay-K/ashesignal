import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { scanWhales } from "@/lib/market/whale-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const url = new URL(req.url);
  const batch = url.searchParams.get("batch") != null ? Number(url.searchParams.get("batch")) : Math.floor(new Date().getMinutes() / 5) % 6;
  try {
    return NextResponse.json({ ok: true, batch, ...(await scanWhales(sb, batch)), at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
