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

export async function GET(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const key = req.nextUrl.searchParams.get("key");
  if (key) {
    const { data } = await sb!.from("token_notes").select("*").eq("user_id", user!.id).eq("asset_key", key).maybeSingle();
    return NextResponse.json({ note: data?.note ?? "", updatedAt: data?.updated_at ?? null });
  }
  const { data } = await sb!.from("token_notes").select("*").eq("user_id", user!.id).order("updated_at", { ascending: false });
  return NextResponse.json({ notes: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const note = String(b.note ?? "").slice(0, 5000);
  if (!note.trim()) {
    await sb!.from("token_notes").delete().eq("user_id", user!.id).eq("asset_key", b.key);
    return NextResponse.json({ ok: true });
  }
  const { error } = await sb!.from("token_notes").upsert({ user_id: user!.id, asset_key: b.key, symbol: b.symbol ?? null, note, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
