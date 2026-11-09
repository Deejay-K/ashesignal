import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { deliver } from "@/lib/alerts/notify";
import { buildWeeklyReview } from "@/lib/review";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sunday weekly review for users with the digest on (runs with the hourly worker; sends once per week at digest_hour on Sunday). */
export async function GET(req: Request) {
  try { return await run(req); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

async function run(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const now = new Date();
  if (!force && now.getUTCDay() !== 0) return NextResponse.json({ ok: true, sent: 0, note: "not Sunday" });
  const weekKey = now.toISOString().slice(0, 10);
  let q = sb.from("profiles").select("id, trading_balance, risk_pct, preferences, digest_hour").eq("digest_enabled", true);
  if (!force) q = q.eq("digest_hour", now.getUTCHours());
  const { data: users } = await q;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  const to = new Date(monday.getTime() + 7 * 86_400_000);
  const [sig, hist] = await Promise.all([
    sb.from("signal_log").select("kind, outcome, emitted_at, side, timeframe").gte("emitted_at", monday.toISOString()).lt("emitted_at", to.toISOString()).limit(2000),
    sb.from("category_history").select("category, prev_category, changed_at").gte("changed_at", monday.toISOString()).lt("changed_at", to.toISOString()).limit(5000),
  ]);
  let sent = 0;
  for (const u of users ?? []) {
    if (!force && u.preferences?.reviewSent === weekKey) continue;
    const { data: journal } = await sb.from("saved_setups").select("*").eq("user_id", u.id).eq("taken", true).gte("created_at", new Date(monday.getTime() - 60 * 86_400_000).toISOString());
    const r = buildWeeklyReview({ journal: (journal ?? []) as never, signals: (sig.data ?? []) as never, history: (hist.data ?? []) as never, tradingBalance: u.trading_balance ? Number(u.trading_balance) : null, riskPct: u.risk_pct ? Number(u.risk_pct) : null, from: monday, to });
    await deliver(sb, { userId: u.id, alertId: null, symbol: "REVIEW", kind: "review", title: `Weekly review: ${r.journal.taken} trades, ${r.journal.winRate != null ? r.journal.winRate + "% win rate, " : ""}${r.journal.pnlUsd >= 0 ? "+" : ""}$${r.journal.pnlUsd.toFixed(2)}${r.journal.flags.length ? `, ${r.journal.flags.length} flag${r.journal.flags.length > 1 ? "s" : ""}` : ""}`, body: r.text, url: "/review" });
    await sb.from("profiles").update({ preferences: { ...(u.preferences ?? {}), reviewSent: weekKey } }).eq("id", u.id);
    sent++;
  }
  return NextResponse.json({ ok: true, sent });
}
