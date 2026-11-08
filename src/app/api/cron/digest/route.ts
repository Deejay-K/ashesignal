import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { deliver } from "@/lib/alerts/notify";
import { digestShared, buildDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Daily digest (runs hourly; sends to users whose digest_hour matches the current UTC hour and who have not
 * received one today): trade conditions, Confirmed trades placeable on the user's exchange, open journal
 * trades and their status, and coins that lost confirmation in the last 24 h.
 */
export async function GET(req: Request) {
  try {
    return await run(req);
  } catch (e) {
    // Never let the worker surface as a blank 500: report what broke.
    return NextResponse.json({ error: (e as Error).message, stack: process.env.NODE_ENV === "production" ? undefined : (e as Error).stack }, { status: 500 });
  }
}

async function run(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1"; // send now regardless of hour (testing)
  const dry = url.searchParams.get("dry") === "1";     // build the digests but do not send or mark
  const hour = new Date().getUTCHours();
  const today = new Date().toISOString().slice(0, 10);
  let q = sb.from("profiles").select("id, email, preferences, digest_hour, digest_last_sent, notify_email").eq("digest_enabled", true);
  if (!force) q = q.eq("digest_hour", hour);
  const { data: users, error: uerr } = await q;
  if (uerr) return NextResponse.json({ error: `profiles: ${uerr.message}. Did you run supabase/schema.sql after the last update?` }, { status: 500 });
  const due = (users ?? []).filter((u) => force || u.digest_last_sent !== today);
  if (!due.length) return NextResponse.json({ ok: true, sent: 0, hour, note: force ? "No user has the daily digest enabled (Account > Notifications)." : "Nobody is due this hour." });

  const shared = await digestShared(sb);
  const cond = shared.cond;

  let sent = 0;
  const previews: { user: string; title: string; body: string }[] = [];
  const failures: string[] = [];
  for (const u of due) {
   try {
    const { title, body } = await buildDigest(sb, u.id, u.preferences?.venue, shared);
    const lines = [body];
    if (dry) { previews.push({ user: u.email ?? u.id, title, body: lines.join("\n") }); continue; }
    await deliver(sb, { userId: u.id, alertId: null, symbol: "DIGEST", title, body: lines.join("\n"), url: "/opportunities?cat=confirmed" });
    await sb.from("profiles").update({ digest_last_sent: today }).eq("id", u.id);
    sent++;
   } catch (e) { failures.push(`${u.email ?? u.id}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok: true, sent, hour, dry, previews: dry ? previews : undefined, failures, conditions: cond?.headline ?? null, confirmedRows: shared.confirmed.length });
}
