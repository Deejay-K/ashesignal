import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildWeeklyReview } from "@/lib/review";

export const dynamic = "force-dynamic";

/** GET ?weeks=0 (this week) | 1 (last week) ... */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const back = Math.max(0, Number(req.nextUrl.searchParams.get("weeks") ?? 0));
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - back * 7));
  const to = new Date(monday.getTime() + 7 * 86_400_000);
  const admin = supabaseAdmin();
  const [{ data: journal }, { data: prof }, sig, hist] = await Promise.all([
    sb.from("saved_setups").select("*").eq("user_id", auth.user.id).eq("taken", true).gte("created_at", new Date(monday.getTime() - 60 * 86_400_000).toISOString()),
    sb.from("profiles").select("trading_balance, risk_pct").eq("id", auth.user.id).maybeSingle(),
    admin ? admin.from("signal_log").select("kind, outcome, emitted_at, side, timeframe").gte("emitted_at", monday.toISOString()).lt("emitted_at", to.toISOString()).limit(2000) : Promise.resolve({ data: [] }),
    admin ? admin.from("category_history").select("category, prev_category, changed_at").gte("changed_at", monday.toISOString()).lt("changed_at", to.toISOString()).limit(5000) : Promise.resolve({ data: [] }),
  ]);
  const r = buildWeeklyReview({ journal: (journal ?? []) as never, signals: (sig.data ?? []) as never, history: (hist.data ?? []) as never, tradingBalance: prof?.trading_balance ? Number(prof.trading_balance) : null, riskPct: prof?.risk_pct ? Number(prof.risk_pct) : null, from: monday, to });
  return NextResponse.json(r);
}
