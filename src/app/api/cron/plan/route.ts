import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { ensureEngineConfig } from "@/lib/engine-config";
import { buildPlan, planText } from "@/lib/plan";
import { deliver } from "@/lib/alerts/notify";
import { isVenueId } from "@/lib/venues";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hourly: sends the morning plan to each user whose plan_hour (UTC) is now. ?force=1 sends to everyone enabled, ?dry=1 previews. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  await ensureEngineConfig();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  const hour = new Date().getUTCHours();
  const today = new Date().toISOString().slice(0, 10);
  let q = sb.from("profiles").select("id, email, preferences, plan_hour, plan_last_sent").eq("plan_enabled", true);
  if (!force) q = q.eq("plan_hour", hour);
  const { data: users, error } = await q;
  if (error) return NextResponse.json({ error: `profiles: ${error.message}. Did you run supabase/schema.sql after the last update?` }, { status: 500 });
  const due = (users ?? []).filter((u) => force || u.plan_last_sent !== today);
  if (!due.length) return NextResponse.json({ ok: true, sent: 0, hour, note: force ? "Nobody has the morning plan enabled (Account > Notifications)." : "Nobody is due this hour." });
  const started = Date.now();
  let sent = 0; const previews: unknown[] = []; const failures: string[] = [];
  for (const u of due) {
    if (Date.now() - started > 45_000) break;
    try {
      const venue = isVenueId(u.preferences?.venue) ? u.preferences.venue : "binance";
      const plan = await buildPlan(sb, u.id, venue);
      const { title, body } = planText(plan);
      if (dry) { previews.push({ user: u.email ?? u.id, title, body }); continue; }
      await deliver(sb, { userId: u.id, alertId: null, symbol: "PLAN", kind: "digest", title, body, url: "/plan" });
      await sb.from("profiles").update({ plan_last_sent: today }).eq("id", u.id);
      sent++;
    } catch (e) { failures.push(`${u.email ?? u.id}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok: true, sent, hour, dry, previews: dry ? previews : undefined, failures });
}
