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

/** All lists with their items. */
export async function GET() {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const [{ data: lists }, { data: items }] = await Promise.all([
    sb!.from("watchlists").select("*").eq("user_id", user!.id).order("position").order("created_at"),
    sb!.from("watchlist_items").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }),
  ]);
  return NextResponse.json({
    lists: (lists ?? []).map((l) => ({ id: l.id, name: l.name, items: (items ?? []).filter((i) => i.watchlist_id === l.id).map((i) => ({ id: i.coingecko_id ?? `addr:${i.chain}:${i.address}`, rowId: i.id, symbol: i.symbol, name: i.name, chain: i.chain ?? undefined, address: i.address ?? undefined })) })),
  });
}

/** { action: "create", name } | { action: "rename", id, name } | { action: "delete", id } | { action: "move", rowId, toListId } */
export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: "action required" }, { status: 400 });
  let error: { message: string } | null = null;
  if (b.action === "create") ({ error } = await sb!.from("watchlists").insert({ user_id: user!.id, name: String(b.name ?? "New list").slice(0, 40), position: Date.now() % 100000 }));
  else if (b.action === "rename") ({ error } = await sb!.from("watchlists").update({ name: String(b.name).slice(0, 40) }).eq("id", b.id).eq("user_id", user!.id));
  else if (b.action === "delete") {
    const { count } = await sb!.from("watchlists").select("id", { count: "exact", head: true }).eq("user_id", user!.id);
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "You need at least one list." }, { status: 400 });
    ({ error } = await sb!.from("watchlists").delete().eq("id", b.id).eq("user_id", user!.id));
  } else if (b.action === "move") ({ error } = await sb!.from("watchlist_items").update({ watchlist_id: b.toListId }).eq("id", b.rowId).eq("user_id", user!.id));
  else return NextResponse.json({ error: "unknown action" }, { status: 400 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
