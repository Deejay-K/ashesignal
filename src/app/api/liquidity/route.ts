import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { liquidityChanges } from "@/lib/market/liquidity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ changes: [], note: "Liquidity tracking needs the worker (SUPABASE_SERVICE_ROLE_KEY)." });
  const hours = Number(req.nextUrl.searchParams.get("hours") ?? 24);
  return NextResponse.json({ changes: await liquidityChanges(sb, hours), hours });
}
