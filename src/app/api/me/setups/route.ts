import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function ctx() {
  const sb = await supabaseServer();
  if (!sb) return { sb: null, user: null, res: NextResponse.json({ error: "accounts disabled" }, { status: 501 }) };
  const { data } = await sb.auth.getUser();
  if (!data.user) return { sb, user: null, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { sb, user: data.user, res: null };
}

export async function GET() {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const { data, error } = await sb!.from("saved_setups").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setups: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.setup || !b.symbol || !b.timeframe) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const s = b.setup;
  const row = {
    user_id: user!.id,
    asset_key: b.assetKey ?? `cg:${b.symbol.toLowerCase()}`,
    symbol: b.symbol,
    timeframe: b.timeframe,
    side: s.side,
    kind: s.kind,
    entry_low: s.entry.low,
    entry_high: s.entry.high,
    tp1: s.takeProfits[0]?.price ?? null,
    tp2: s.takeProfits[1]?.price ?? null,
    tp3: s.takeProfits[2]?.price ?? null,
    sl1: s.stopLosses[0]?.price ?? null,
    sl2: s.stopLosses[1]?.price ?? null,
    rr: s.riskRewardTp2,
    confidence: s.confidence,
    score: b.score ?? null,
    payload: s,
  };
  const { data, error } = await sb!.from("saved_setups").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.id || !b.status) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const { error } = await sb!.from("saved_setups").update({ status: b.status, resolved_at: b.status === "open" ? null : new Date().toISOString() }).eq("id", b.id).eq("user_id", user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await sb!.from("saved_setups").delete().eq("id", id).eq("user_id", user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
