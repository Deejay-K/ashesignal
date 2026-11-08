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
    leverage: s.leverage?.recommended ?? null,
    confidence: s.confidence,
    score: b.score ?? null,
    payload: s,
    // journal fields (optional): "I took this trade"
    taken: !!b.taken,
    taken_at: b.taken ? new Date().toISOString() : null,
    exchange: b.exchange ?? null,
    fill_price: num(b.fillPrice),
    size_units: num(b.sizeUnits),
    size_usd: num(b.sizeUsd),
    risk_usd: num(b.riskUsd),
    fees_usd: num(b.feesUsd),
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : null,
  };
  const { data, error } = await sb!.from("saved_setups").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

const num = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * PATCH: status change (legacy) or journal update.
 * Journal fields: taken, exchange, fillPrice, sizeUnits, sizeUsd, riskUsd, feesUsd, notes, and a manual close
 * { exitPrice, exitReason } which computes realized P&L in dollars and R.
 */
export async function PATCH(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const { data: row } = await sb!.from("saved_setups").select("*").eq("id", b.id).eq("user_id", user!.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const upd: Record<string, unknown> = {};
  if (b.status) { upd.status = b.status; upd.resolved_at = b.status === "open" ? null : new Date().toISOString(); }
  if (typeof b.taken === "boolean") { upd.taken = b.taken; upd.taken_at = b.taken ? row.taken_at ?? new Date().toISOString() : null; }
  for (const [k, col] of [["exchange", "exchange"], ["notes", "notes"]] as const) if (k in b) upd[col] = b[k] == null ? null : String(b[k]).slice(0, 2000);
  for (const [k, col] of [["fillPrice", "fill_price"], ["sizeUnits", "size_units"], ["sizeUsd", "size_usd"], ["riskUsd", "risk_usd"], ["feesUsd", "fees_usd"]] as const) if (k in b) upd[col] = num(b[k]);
  if (b.exitPrice != null) {
    const exit = Number(b.exitPrice);
    const fill = Number(upd.fill_price ?? row.fill_price ?? (Number(row.entry_low) + Number(row.entry_high)) / 2);
    const units = Number(upd.size_units ?? row.size_units ?? 0);
    const fees = Number(upd.fees_usd ?? row.fees_usd ?? 0);
    const dir = row.side === "LONG" ? 1 : -1;
    const pnl = units > 0 && Number.isFinite(fill) ? (exit - fill) * dir * units - fees : null;
    const riskPerUnit = Math.abs(fill - Number(row.sl1 ?? fill));
    const riskUsd = Number(upd.risk_usd ?? row.risk_usd ?? (units > 0 && riskPerUnit > 0 ? units * riskPerUnit : 0));
    upd.exit_price = exit;
    upd.exit_at = new Date().toISOString();
    upd.exit_reason = b.exitReason ?? "manual";
    upd.realized_usd = pnl;
    upd.realized_r = pnl != null && riskUsd > 0 ? Math.round((pnl / riskUsd) * 100) / 100 : riskPerUnit > 0 ? Math.round((((exit - fill) * dir) / riskPerUnit) * 100) / 100 : null;
    if (!row.resolved_at) { upd.status = "closed"; upd.resolved_at = upd.exit_at; }
  }
  if (b.reopen) { upd.exit_price = null; upd.exit_at = null; upd.exit_reason = null; upd.realized_usd = null; upd.realized_r = null; upd.status = "open"; upd.resolved_at = null; }
  const { error } = await sb!.from("saved_setups").update(upd).eq("id", b.id).eq("user_id", user!.id);
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
