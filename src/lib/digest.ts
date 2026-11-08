// Daily digest text, shared by the hourly cron and the Telegram /digest command.
import type { SupabaseClient } from "@supabase/supabase-js";
import { globalConditions, summarize } from "./market/conditions";
import { venueListings, venuesFor, VENUE_META, isVenueId, type VenueId } from "./venues";
import { fmtUsd } from "./format";
import { safe } from "./fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DigestShared { cond: ReturnType<typeof summarize> | null; listings: Awaited<ReturnType<typeof venueListings>>; confirmed: any[]; lost: any[] }

export async function digestShared(sb: SupabaseClient): Promise<DigestShared> {
  const [condR, listings, { data: confirmed }, { data: lost }] = await Promise.all([
    safe(globalConditions()),
    venueListings(),
    sb.from("coin_metrics").select("asset_key, symbol, timeframe, price, detail, category_since").eq("category", "confirmed").order("category_since", { ascending: false }).limit(60),
    sb.from("category_history").select("symbol, timeframe, reason, changed_at").eq("prev_category", "confirmed").gt("changed_at", new Date(Date.now() - 86_400_000).toISOString()).order("changed_at", { ascending: false }).limit(10),
  ]);
  return { cond: condR.ok ? summarize(condR.data.conditions) : null, listings, confirmed: confirmed ?? [], lost: lost ?? [] };
}

/** One user's digest. `venuePref` comes from profiles.preferences.venue. */
export async function buildDigest(sb: SupabaseClient, userId: string, venuePref: unknown, shared: DigestShared): Promise<{ title: string; body: string; venue: VenueId; confirmedCount: number; openCount: number }> {
  const venue: VenueId = isVenueId(venuePref) ? venuePref : "binance";
  const canShort = VENUE_META[venue].canShort;
  const mine = shared.confirmed.filter((r) => r.symbol && venuesFor(String(r.symbol), shared.listings, venue).includes(venue)).filter((r) => canShort || r.detail?.setup?.side === "LONG")
    .sort((a, b) => (b.detail?.setup?.confidence ?? 0) - (a.detail?.setup?.confidence ?? 0));
  const { data: open } = await sb.from("saved_setups").select("symbol, side, timeframe, status, fill_price, size_usd, risk_usd, max_favorable_pct, max_adverse_pct").eq("user_id", userId).eq("taken", true).is("exit_price", null).limit(20);
  const cond = shared.cond;
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
  if (shared.lost.length) {
    lines.push("");
    lines.push(`Lost confirmation in the last 24 h: ${shared.lost.slice(0, 5).map((l) => `${l.symbol} ${l.timeframe}`).join(", ")}`);
  }
  lines.push("");
  lines.push("Manual trading only. Not financial advice.");
  const title = `AsheSignal daily: ${mine.length} confirmed on ${VENUE_META[venue].label}, ${open?.length ?? 0} open trade${(open?.length ?? 0) === 1 ? "" : "s"}${cond && cond.verdict !== "ok" ? `, conditions: ${cond.verdict}` : ""}`;
  return { title, body: lines.join("\n"), venue, confirmedCount: mine.length, openCount: open?.length ?? 0 };
}
