import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ rows: [], note: "Screener needs the worker (SUPABASE_SERVICE_ROLE_KEY)." });
  const tf = req.nextUrl.searchParams.get("tf") ?? "4h";
  const { data } = await sb.from("coin_metrics").select("*").eq("timeframe", tf).order("opportunity", { ascending: false }).limit(300);
  const newest = (data ?? []).reduce((m, r) => Math.max(m, Date.parse(r.updated_at)), 0);
  return NextResponse.json({ rows: data ?? [], tf, updatedAt: newest || null });
}
