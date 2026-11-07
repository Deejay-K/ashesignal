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

const itemId = (r: { coingecko_id: string | null; chain: string | null; address: string | null }) => r.coingecko_id ?? `addr:${r.chain}:${r.address}`;

export async function GET() {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const { data, error } = await sb!.from("watchlist_items").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []).map((r) => ({ id: itemId(r), symbol: r.symbol, name: r.name, chain: r.chain ?? undefined, address: r.address ?? undefined })) });
}

/** Upsert one or many items: { items: WatchItem[] } */
export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const body = (await req.json().catch(() => ({}))) as { items?: { id: string; symbol: string; name: string; chain?: string; address?: string }[] };
  const items = body.items ?? [];
  const { data: wl } = await sb!.from("watchlists").select("id").eq("user_id", user!.id).order("position").limit(1).maybeSingle();
  let watchlistId = wl?.id as string | undefined;
  if (!watchlistId) {
    const { data: created } = await sb!.from("watchlists").insert({ user_id: user!.id, name: "Favorites" }).select("id").single();
    watchlistId = created?.id;
  }
  const rows = items.map((i) => ({
    watchlist_id: watchlistId,
    user_id: user!.id,
    coingecko_id: i.address ? null : i.id,
    chain: i.chain ?? null,
    address: i.address ?? null,
    symbol: i.symbol,
    name: i.name ?? null,
  }));
  if (rows.length) {
    const { error } = await sb!.from("watchlist_items").upsert(rows, { onConflict: "watchlist_id,coingecko_id,chain,address", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  let q = sb!.from("watchlist_items").delete().eq("user_id", user!.id);
  if (id.startsWith("addr:")) {
    const [, chain, address] = id.split(":");
    q = q.eq("chain", chain).eq("address", address);
  } else q = q.eq("coingecko_id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
