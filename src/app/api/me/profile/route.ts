import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await sb.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  return NextResponse.json({ profile: data, email: u.user.email });
}

export async function PUT(req: NextRequest) {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowed = ["display_name", "trading_balance", "portfolio_value", "risk_pct", "max_exposure_pct", "default_leverage", "preferences"];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in b) patch[k] = b[k];
  const { error } = await sb.from("profiles").upsert({ id: u.user.id, ...patch });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
