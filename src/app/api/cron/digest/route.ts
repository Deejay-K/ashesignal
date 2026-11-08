import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { deliver } from "@/lib/alerts/notify";
import { globalConditions, summarize } from "@/lib/market/conditions";
import { venueListings, venuesFor, VENUE_META, isVenueId, type VenueId } from "@/lib/venues";
import { fmtUsd } from "@/lib/format";
import { safe } from "@/lib/fetch";

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

  const [condR, listings, { data: confirmed }, { data: lost }] = await Promise.all([
    safe(globalConditions()),
    venueListings(),
    sb.from("coin_metrics").select("asset_key, symbol, timeframe, price, detail, category_since").eq("category", "confirmed").order("category_since", { ascending: false }).limit(60),
    sb.from("category_history").select("symbol, timeframe, reason, changed_at").eq("prev_category", "confirmed").gt("changed_at", new Date(Date.now() - 86_400_000).toISOString()).order("changed_at", { ascending: false }).limit(10),
  ]);
  const cond = condR.ok ? summarize(condR.data.conditions) : null;

  let sent = 0;
  const previews: { user: string; title: string; body: string }[] = [];
  const failures: string[] = [];
  for (const u of due) {
   try {
    const venue: VenueId = isVenueId(u.preferences?.venue) ? u.preferences.venue : "binance";
    const canShort = VENUE_META[venue].canShort;
    const mine = (confirmed ?? []).filter((r) => r.symbol && venuesFor(String(r.symbol), listings, venue).includes(venue)).filter((r) => canShort || r.detail?.setup?.side === "LONG")
      .sort((a, b) => (b.detail?.setup?.confidence ?? 0) - (a.detail?.setup?.confidence ?? 0));
    const { data: open } = await sb.from("saved_setups").select("symbol, side, timeframe, status, fill_price, size_usd, risk_usd, max_favorable_pct, max_adverse_pct").eq("user_id", u.id).eq("taken", true).is("exit_price", null).limit(20);
    const lines: string[] = [];
    lines.push(cond ? `Conditions: ${cond.headline}.` : "Conditions: unavailable.");
    lines.push("");
    lines.push(`Confirmed trades you can place on ${VENUE_META[venue].label}${canShort ? "" : " (longs only)"}: ${mine.length}`);
    for (const r of mine.slice(0, 3)) {
      const s = r.detail?.setup;
      if (!s) continue;
      lines.push(`- ${r.symbol} ${s.side} ${r.timeframe}: entry ${fmtUsd(s.entry?.low)}-${fmtUsd(s.entry?.high)}, SL ${fmtUsd(s.stopLosses?.[0]?.price)}, TP1 ${fmtUsd(s.takeProfits?.[0]?.price)}, TP2 ${fmtUsd(s.takeProfits?.[1]?.price)} (${s.rr}R, conf ${s.confidence}%)`);
    }
    if (mine.length > 3) lines.push(`- and ${mine.length - 3} more on the Trading Discovery page`);
    lines.push("");
    if (open?.length) {
      lines.push(`Your open trades: ${open.length}`);
      for (const t of open) lines.push(`- ${t.symbol} ${t.side} ${t.timeframe}: ${t.status}${t.max_favorable_pct != null ? `, best +${t.max_favorable_pct}% / worst -${t.max_adverse_pct}%` : ""}${t.risk_usd ? `, ${fmtUsd(t.risk_usd)} at risk` : ""}`);
    } else lines.push("Your open trades: none.");
    if (lost?.length) {
      lines.push("");
      lines.push(`Lost confirmation in the last 24 h: ${lost.slice(0, 5).map((l) => `${l.symbol} ${l.timeframe}`).join(", ")}`);
    }
    lines.push("");
    lines.push("Manual trading only. Not financial advice.");
    const title = `AsheSignal daily: ${mine.length} confirmed on ${VENUE_META[venue].label}, ${open?.length ?? 0} open trade${(open?.length ?? 0) === 1 ? "" : "s"}${cond && cond.verdict !== "ok" ? `, conditions: ${cond.verdict}` : ""}`;
    if (dry) { previews.push({ user: u.email ?? u.id, title, body: lines.join("\n") }); continue; }
    await deliver(sb, { userId: u.id, alertId: null, symbol: "DIGEST", title, body: lines.join("\n"), url: "/opportunities?cat=confirmed" });
    await sb.from("profiles").update({ digest_last_sent: today }).eq("id", u.id);
    sent++;
   } catch (e) { failures.push(`${u.email ?? u.id}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok: true, sent, hour, dry, previews: dry ? previews : undefined, failures, conditions: cond?.headline ?? null, confirmedRows: confirmed?.length ?? 0 });
}
