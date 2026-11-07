import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPairsByToken } from "@/lib/providers/dexscreener";
import { safe } from "@/lib/fetch";

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
  const [{ data: alerts }, { data: events }] = await Promise.all([
    sb!.from("alerts").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }),
    sb!.from("alert_events").select("*").eq("user_id", user!.id).order("fired_at", { ascending: false }).limit(50),
  ]);
  return NextResponse.json({ alerts: alerts ?? [], events: events ?? [] });
}

export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.type || !b.symbol) return NextResponse.json({ error: "type and symbol required" }, { status: 400 });
  const assetRef = { ...(b.assetRef ?? { symbol: b.symbol }) } as Record<string, unknown>;
  if (assetRef.address && !assetRef.chain) {
    const pairs = await safe(getPairsByToken(String(assetRef.address)));
    if (pairs.ok && pairs.data[0]) { assetRef.chain = pairs.data[0].chainId; if (!b.symbol || b.symbol === "WHALE") b.symbol = pairs.data[0].baseToken.symbol; }
  }
  const row = { user_id: user!.id, asset_key: b.assetKey ?? `sym:${b.symbol}`, symbol: String(b.symbol).toUpperCase(), type: b.type, timeframe: b.timeframe ?? "1h", params: b.params ?? {}, asset_ref: assetRef, channels: b.channels ?? ["push"], cooldown_minutes: b.cooldownMinutes ?? 60 };
  const { data, error } = await sb!.from("alerts").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (b.markRead) {
    await sb!.from("alert_events").update({ read: true }).eq("user_id", user!.id).eq("read", false);
    return NextResponse.json({ ok: true });
  }
  const { error } = await sb!.from("alerts").update({ active: b.active }).eq("id", b.id).eq("user_id", user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await sb!.from("alerts").delete().eq("id", id).eq("user_id", user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
