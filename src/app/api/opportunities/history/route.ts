import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Category change history: ?asset=cg:bitcoin for one asset, otherwise the latest changes across all. */
export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ rows: [] });
  const asset = req.nextUrl.searchParams.get("asset");
  let q = sb.from("category_history").select("*").order("changed_at", { ascending: false }).limit(asset ? 60 : 80);
  if (asset) q = q.eq("asset_key", asset);
  const { data } = await q;
  return NextResponse.json({ rows: data ?? [] });
}
