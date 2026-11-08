import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { portfolioHeat, heatIfAdded, type OpenTrade } from "@/lib/risk/heat";

export const dynamic = "force-dynamic";

/** GET: heat of open journal trades. ?symbol=&side=&risk= previews adding a trade. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [{ data: open }, { data: prof }] = await Promise.all([
    sb.from("saved_setups").select("symbol, side, risk_usd, timeframe").eq("user_id", auth.user.id).eq("taken", true).is("exit_price", null).eq("status", "open"),
    sb.from("profiles").select("trading_balance, preferences").eq("id", auth.user.id).maybeSingle(),
  ]);
  const trades: OpenTrade[] = (open ?? []).map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd), timeframe: t.timeframe }));
  const balance = prof?.trading_balance ? Number(prof.trading_balance) : null;
  const limits = { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) };
  const sp = req.nextUrl.searchParams;
  const current = portfolioHeat(trades, balance, limits);
  const preview = sp.get("symbol") ? heatIfAdded(trades, { symbol: sp.get("symbol")!, side: sp.get("side") === "SHORT" ? "SHORT" : "LONG", riskUsd: Number(sp.get("risk") ?? 0) || null }, balance, limits) : null;
  return NextResponse.json({ current, preview, balance });
}
