import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = sb ? await sb.auth.getUser() : null;
  if (!sb || !auth?.data.user) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { data } = await sb.from("saved_setups").select("symbol, side, timeframe, kind, paper, taken, taken_at, created_at, exchange, realized_r, realized_usd, pretrade_verdict, leverage_used, leverage").eq("user_id", auth.data.user.id).eq("taken", true).limit(3000);
  return NextResponse.json(buildAnalytics(data ?? [], { paper: req.nextUrl.searchParams.get("paper") === "1" }));
}
