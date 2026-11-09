// Lifecycle messages for broadcast Confirmed trades: entered the zone, TP1 hit (move stop to break-even), TP2 hit,
// stop hit, lost confirmation. One message per event per trade, to everyone who received the signal.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketsByIds } from "./providers/coingecko";
import { venueListings, venuesFor, VENUE_IDS, type VenueId } from "./venues";
import { loadRecipients, canReceive } from "./telegram-broadcast";
import { tgSend, esc, type Keyboard } from "./telegram";
import { fmtUsd } from "./format";
import { safe } from "./fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (p: string) => (SITE() ? `${SITE()}${p}` : undefined);
const MAX_AGE_DAYS = 10;

type Event = { type: "zone" | "tp1" | "tp2" | "tp3" | "sl" | "lost" | "expired"; row: any; price: number | null };

function detect(row: any, price: number): Event[] {
  const out: Event[] = [];
  const long = row.side === "LONG";
  const hit = (lvl: number | null, above: boolean) => lvl != null && (above ? price >= Number(lvl) : price <= Number(lvl));
  if (!row.zone_at && price >= Number(row.entry_low) && price <= Number(row.entry_high)) out.push({ type: "zone", row, price });
  if (!row.sl_at && hit(row.sl1, !long)) { out.push({ type: "sl", row, price }); return out; }
  if (!row.tp1_at && hit(row.tp1, long)) out.push({ type: "tp1", row, price });
  if (!row.tp2_at && hit(row.tp2, long)) out.push({ type: "tp2", row, price });
  if (!row.tp3_at && hit(row.tp3, long)) out.push({ type: "tp3", row, price });
  return out;
}

function message(e: Event): { text: string; close: boolean } {
  const r = e.row; const s = `<b>${esc(r.symbol)} ${r.side} ${esc(r.timeframe)}</b>`;
  const p = e.price != null ? fmtUsd(e.price) : "";
  switch (e.type) {
    case "zone": return { text: `🎯 ${s}: price ${p} is <b>in the entry zone</b> (${fmtUsd(r.entry_low)} to ${fmtUsd(r.entry_high)}).\nIf you want this trade, a limit order here is the plan. Stop ${fmtUsd(r.sl1)}, TP1 ${fmtUsd(r.tp1)}.`, close: false };
    case "tp1": return { text: `✅ ${s}: <b>TP1 hit</b> at ${fmtUsd(r.tp1)} (price ${p}).\nPlan: take about 30% off, move the stop to break-even (${fmtUsd((Number(r.entry_low) + Number(r.entry_high)) / 2)}). From here it is a free trade.`, close: false };
    case "tp2": return { text: `✅✅ ${s}: <b>TP2 hit</b> at ${fmtUsd(r.tp2)} (price ${p}).\nPlan: take another 30% off, trail the stop under the last higher low (or above the last lower high on a short). TP3 ${fmtUsd(r.tp3)} runs.`, close: r.tp3 == null };
    case "tp3": return { text: `🏁 ${s}: <b>TP3 hit</b> at ${fmtUsd(r.tp3)} (price ${p}). Full target reached; close the rest. Signal complete.`, close: true };
    case "sl": return { text: `⛔ ${s}: <b>stop hit</b> at ${fmtUsd(r.sl1)} (price ${p}).\nIf you were in, you are out with the planned loss. Do not re-enter on the same idea; wait for a new confirmation.`, close: true };
    case "lost": return { text: `⚠️ ${s}: the engine <b>no longer confirms</b> this setup${e.price != null ? ` (price ${p})` : ""}.\nIf you are in and not yet at TP1, tighten the stop or exit; the reason for the trade is gone.`, close: true };
    default: return { text: `⌛ ${s}: ${MAX_AGE_DAYS} days without resolution. Tracking stopped.`, close: true };
  }
}

export async function runFollowups(sb: SupabaseClient, budgetMs = 40_000): Promise<{ checked: number; events: number; sent: number }> {
  const started = Date.now();
  const { data: rows } = await sb.from("signal_followups").select("*").is("closed_at", null).order("emitted_at", { ascending: true }).limit(200);
  if (!rows?.length) return { checked: 0, events: 0, sent: 0 };
  const ids = [...new Set(rows.map((r: any) => r.coingecko_id as string))];
  const mk = await safe(getMarketsByIds(ids));
  const price = new Map<string, number>();
  if (mk.ok) for (const m of mk.data) if (m.priceUsd) price.set(m.id, m.priceUsd);
  // lost confirmation in the last 15 minutes
  const { data: lost } = await sb.from("category_history").select("asset_key, timeframe, changed_at").eq("prev_category", "confirmed").gt("changed_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const lostSet = new Set((lost ?? []).map((l: any) => `${l.asset_key}|${l.timeframe}`));
  const events: Event[] = [];
  for (const r of rows) {
    const p = price.get(r.coingecko_id) ?? null;
    if (p != null) events.push(...detect(r, p));
    if (!r.lost_at && lostSet.has(`${r.asset_key}|${r.timeframe}`) && !r.tp1_at) events.push({ type: "lost", row: r, price: p });
    if (Date.now() - Date.parse(r.emitted_at) > MAX_AGE_DAYS * 86_400_000) events.push({ type: "expired", row: r, price: p });
    await sb.from("signal_followups").update({ last_price: p, last_checked_at: new Date().toISOString() }).eq("id", r.id);
  }
  if (!events.length) return { checked: rows.length, events: 0, sent: 0 };
  const [recipients, listings] = await Promise.all([loadRecipients(sb), venueListings()]);
  const listingsUnknown = Object.values(listings).every((set) => !set || set.size === 0);
  let sent = 0;
  for (const e of events) {
    if (Date.now() - started > budgetMs) break;
    const r = e.row;
    const { text, close } = message(e);
    const patch: Record<string, unknown> = { [`${e.type === "expired" ? "closed" : e.type}_at`]: new Date().toISOString() };
    if (close) patch.closed_at = new Date().toISOString();
    await sb.from("signal_followups").update(patch).eq("id", r.id);
    const listed = listingsUnknown ? ([...VENUE_IDS] as VenueId[]) : venuesFor(r.symbol, listings, null);
    const kb: Keyboard = [[{ text: "🔎 Full card", callback_data: `setup:${r.coingecko_id.length <= 36 ? r.coingecko_id : `~${r.symbol}`}:${r.timeframe}` }, ...(link("/") ? [{ text: "Journal", url: link("/setups")! }] : [])]];
    for (const rc of recipients) {
      if (!canReceive(rc, listed, r.side)) continue;
      if (await tgSend(rc.chatId, text, { html: true, keyboard: kb })) sent++;
      await new Promise((res) => setTimeout(res, 50));
    }
  }
  return { checked: rows.length, events: events.length, sent };
}
