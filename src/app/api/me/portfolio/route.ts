import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildPortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ctx() {
  const sb = await supabaseServer();
  if (!sb) return { sb: null, user: null, res: NextResponse.json({ error: "accounts disabled" }, { status: 501 }) };
  const { data } = await sb.auth.getUser();
  if (!data.user) return { sb, user: null, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { sb, user: data.user, res: null };
}

/** Live portfolio for all of the user's wallets + stored history. ?snapshot=1 stores a point. */
export async function GET(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const [{ data: wallets }, { data: cost }, { data: history }] = await Promise.all([
    sb!.from("wallets").select("*").eq("user_id", user!.id),
    sb!.from("cost_basis").select("*").eq("user_id", user!.id),
    sb!.from("holdings_snapshots").select("taken_at, total_usd").eq("user_id", user!.id).order("taken_at", { ascending: true }).limit(2000),
  ]);
  const cb: Record<string, number> = {};
  for (const c of cost ?? []) cb[`${c.chain}:${c.address}`] = Number(c.cost_per_unit);
  const p = await buildPortfolio((wallets ?? []).map((w) => ({ chain: w.chain, address: w.address, label: w.label })), cb);
  if (req.nextUrl.searchParams.get("snapshot") && (wallets ?? []).length && p.pricedPct >= 50) {
    await sb!.from("holdings_snapshots").insert({ wallet_id: wallets![0].id, user_id: user!.id, total_usd: p.totalUsd, holdings: p.holdings.map((h) => ({ chain: h.chain, address: h.address, symbol: h.symbol, amount: h.amount, price_usd: h.priceUsd, value_usd: h.valueUsd })) });
  }
  // collapse history to one point per day for the chart
  const daily = new Map<string, number>();
  for (const h of history ?? []) daily.set(h.taken_at.slice(0, 10), Number(h.total_usd));
  return NextResponse.json({ portfolio: p, history: [...daily.entries()].map(([d, v]) => ({ date: d, totalUsd: v })) });
}

/** Set cost basis: { chain, address|null, costPerUnit } */
export async function PUT(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.chain || !(Number(b.costPerUnit) >= 0)) return NextResponse.json({ error: "chain and costPerUnit required" }, { status: 400 });
  const address = b.address ?? "native";
  await sb!.from("cost_basis").delete().eq("user_id", user!.id).eq("chain", b.chain).eq("address", address);
  const { error } = await sb!.from("cost_basis").insert({ user_id: user!.id, chain: b.chain, address, cost_per_unit: Number(b.costPerUnit) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
