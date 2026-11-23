// Lifecycle messages for broadcast Confirmed trades: entered the zone, TP1 hit (move stop to break-even), TP2 hit,
// stop hit, cancelled. One message per event per trade, to everyone who received the signal.
//
// Stage 48 - cancellations are detected from the signal's own state, not from a time window. Before, a
// "no longer confirms" message was only sent if the worker happened to run within 15 minutes of the change, and
// never for a signal that ended by a quick wick to its stop or TP1, or by old age. Now every open follow-up is
// compared with its screener row on each run: if that row is no longer the same Confirmed signal, everyone who
// got the signal is told once, with the reason and what to do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketsByIds } from "./providers/coingecko";
import { venueListings, venuesFor, VENUE_IDS, type VenueId } from "./venues";
import { loadRecipients, canReceive } from "./telegram-broadcast";
import { tgSendDetailed, tgPhoto, fetchImage, esc, type Keyboard, type SendOpts, type SendResult } from "./telegram";
import { selectIn } from "./db-pages";
import { fmtUsd } from "./format";
import { safe } from "./fetch";
import { deliver } from "./alerts/notify";
import { signalView } from "./market/signal-state";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (p: string) => (SITE() ? `${SITE()}${p}` : undefined);
const MAX_AGE_DAYS = 10;
const STALE_MS = 6 * 3_600_000;

type Event = { type: "zone" | "tp1" | "tp2" | "tp3" | "sl" | "lost" | "expired"; row: any; price: number | null; reason?: string | null; end?: string | null; byWick?: boolean };

/** Why a signal ended, in a few plain words for the headline of the message. */
const END_LABEL: Record<string, string> = { faded: "momentum faded", flip: "the chart flipped to the other side", regime: "the market turned against it", expired: "it got too old without moving", replaced: "a newer signal replaced it", unlisted: "the coin is no longer scanned" };

/**
 * Is this follow-up's signal still the live Confirmed signal? Compares it with the screener row.
 * Returns null while it stands, else how and why it ended.
 */
export function endedState(f: { emitted_at: string }, row: { category?: string | null; category_since?: string | null; detail?: any } | null | undefined, hist?: { reason?: string | null; snapshot?: any } | null): { end: string; reason: string | null } | null {
  if (!row) return { end: "unlisted", reason: "This coin dropped out of the top coins the screener follows." };
  const clean = (t?: string | null) => (t ? String(t).replace(/^(Live re-check|Signal ended): /, "") : null);
  if (row.category === "confirmed") {
    // Same coin and timeframe Confirmed again later = a new signal with new levels; the one we sent is over.
    const since = row.category_since ? Date.parse(row.category_since) : NaN;
    if (Number.isFinite(since) && since > Date.parse(f.emitted_at) + 3 * 60_000) return { end: hist?.snapshot?.end ?? "replaced", reason: clean(hist?.reason) ?? "A fresh signal with new levels was sent for this coin; the old levels no longer apply." };
    return null;
  }
  const sig = row.detail?.signal;
  if (sig?.state === "ended") return { end: sig.end ?? "faded", reason: clean(sig.reason) };
  return { end: hist?.snapshot?.end ?? "faded", reason: clean(hist?.reason) ?? "The setup no longer passes the engine's checks." };
}

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
    case "tp1": return { text: `✅ ${s}: <b>TP1 hit</b> at ${fmtUsd(r.tp1)}${e.byWick ? " (a candle wick reached it)" : ` (price ${p})`}.\nPlan: take about 30% off, move the stop to break-even (${fmtUsd((Number(r.entry_low) + Number(r.entry_high)) / 2)}). From here it is a free trade.${e.byWick ? "\nThe signal is closed for new entries: it is too late to get in." : ""}`, close: false };
    case "tp2": return { text: `✅✅ ${s}: <b>TP2 hit</b> at ${fmtUsd(r.tp2)} (price ${p}).\nPlan: take another 30% off, trail the stop under the last higher low (or above the last lower high on a short). TP3 ${fmtUsd(r.tp3)} runs.`, close: r.tp3 == null };
    case "tp3": return { text: `🏁 ${s}: <b>TP3 hit</b> at ${fmtUsd(r.tp3)} (price ${p}). Full target reached; close the rest. Signal complete.`, close: true };
    case "sl": return { text: `⛔ ${s}: <b>stop hit</b> at ${fmtUsd(r.sl1)}${e.byWick ? " (a candle wick reached it)" : ` (price ${p})`}.\nIf you were in, you are out with the planned loss. Do not re-enter on the same idea; wait for a new confirmation.`, close: true };
    case "lost": {
      const why = END_LABEL[e.end ?? ""] ?? "it no longer passes the checks";
      const inTrade = !!r.zone_at;
      const advice = r.tp1_at
        ? "TP1 was already hit, so your stop should be at break-even: keep managing what is left, but do not open a new position on it."
        : inTrade
          ? "Price reached the entry zone earlier. If you are in: the reason for the trade is gone, so tighten your stop or close it. If your limit order never filled, cancel it."
          : "Price never reached the entry zone. If you placed a limit order for it, cancel that order now.";
      return { text: `🚫 ${s}: <b>Confirmed Trade CANCELLED</b> (${esc(why)})${e.price != null ? `. Price now ${p}` : ""}.${e.reason ? `\n${esc(e.reason)}` : ""}\n${advice}`, close: !inTrade };
    }
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
  // Re-check every open signal against live candles right now (same rule as the screener, which only visits each
  // coin about once an hour). This is what makes a cancellation arrive within minutes instead of up to an hour.
  const open = new Map<string, { id: string; symbol: string; tf: string }>();
  for (const r of rows) if (!r.lost_at && !r.sl_at) open.set(`${r.asset_key}|${r.timeframe}`, { id: r.coingecko_id, symbol: r.symbol, tf: r.timeframe });
  const todo = [...open.values()].slice(0, 16);
  await Promise.race([
    Promise.all(todo.map((o) => safe(signalView(sb, { id: o.id, symbol: o.symbol }, o.tf as never)))),
    new Promise((res) => setTimeout(res, Math.min(15_000, budgetMs / 2))),
  ]);
  // The screener rows these signals came from, and why any of them stopped being Confirmed since.
  const keys = [...new Set(rows.map((r: any) => r.asset_key as string))];
  const oldest = rows.reduce((m: string, r: any) => (r.emitted_at < m ? r.emitted_at : m), rows[0].emitted_at);
  const [{ data: metrics }, { data: hist }] = await Promise.all([
    sb.from("coin_metrics").select("asset_key, timeframe, category, category_since, detail").in("asset_key", keys),
    sb.from("category_history").select("asset_key, timeframe, changed_at, reason, snapshot").eq("prev_category", "confirmed").in("asset_key", keys).gt("changed_at", oldest).order("changed_at", { ascending: true }),
  ]);
  const metricOf = new Map((metrics ?? []).map((m: any) => [`${m.asset_key}|${m.timeframe}`, m]));
  // If the screener table could not be read at all, say nothing about cancellations this run (never guess).
  const canJudge = !!metrics;
  const events: Event[] = [];
  for (const r of rows) {
    const p = price.get(r.coingecko_id) ?? null;
    const found = p != null ? detect(r, p) : [];
    events.push(...found);
    const closing = found.some((e) => e.type === "sl" || e.type === "tp3");
    if (canJudge && !r.lost_at && !r.sl_at && !closing) {
      const firstEnd = (hist ?? []).find((h: any) => h.asset_key === r.asset_key && h.timeframe === r.timeframe && h.changed_at > r.emitted_at) ?? null;
      const ended = endedState(r, metricOf.get(`${r.asset_key}|${r.timeframe}`), firstEnd);
      // Only announce an end that happened recently. Anything older (signals that ended before this version was
      // installed, or while the worker was down for hours) is recorded quietly: stale news helps nobody.
      const endedAt = Date.parse(metricOf.get(`${r.asset_key}|${r.timeframe}`)?.detail?.signal?.at ?? firstEnd?.changed_at ?? "") || Date.now();
      if (ended && Date.now() - endedAt > STALE_MS) events.push({ type: "lost", row: r, price: null, end: "silent" });
      else if (ended) {
        // A wick to the stop or to TP1 between two checks ends the signal without the price check above seeing it.
        if (ended.end === "stop") events.push({ type: "sl", row: r, price: p, byWick: true });
        else if (ended.end === "tp1") { if (!r.tp1_at && !found.some((e) => e.type === "tp1")) events.push({ type: "tp1", row: r, price: p, byWick: true }); events.push({ type: "lost", row: r, price: null, end: "silent", byWick: true }); }
        else events.push({ type: "lost", row: r, price: p, end: ended.end, reason: ended.reason });
      }
    }
    if (Date.now() - Date.parse(r.emitted_at) > MAX_AGE_DAYS * 86_400_000) events.push({ type: "expired", row: r, price: p });
    await sb.from("signal_followups").update({ last_price: p, last_checked_at: new Date().toISOString() }).eq("id", r.id);
  }
  if (!events.length) return { checked: rows.length, events: 0, sent: 0 };
  const [recipients, listings] = await Promise.all([loadRecipients(sb), venueListings()]);
  const listingsUnknown = Object.values(listings).every((set) => !set || set.size === 0);
  // Stage 54: follow-ups go to exactly the members who received the signal (from the delivery ledger). Follow-ups from
  // before the ledger (no signal_id) keep the old rule: everyone whose exchange and filters would have received it.
  const sigIds = [...new Set(events.map((e) => e.row.signal_id as string | null).filter((x): x is string => !!x))];
  const deliveredTo = new Map<string, Set<string>>();
  if (sigIds.length) {
    // If this lookup fails, stop before any event is marked as done: the next run detects the same events again.
    // (Falling back to "everyone" would message members who never received the signal.)
    let got: any[];
    try { got = await selectIn<any>(sigIds, (ch, a, b) => sb.from("signal_deliveries").select("id, signal_id, recipient").eq("status", "sent").in("signal_id", ch).order("id", { ascending: true }).range(a, b)); }
    catch (e) { console.error(`[followups] recipient lookup failed, will retry: ${(e as Error).message}`); return { checked: rows.length, events: events.length, sent: 0 }; }
    for (const d of got) (deliveredTo.get(d.signal_id) ?? deliveredTo.set(d.signal_id, new Set()).get(d.signal_id)!).add(String(d.recipient));
    for (const id of sigIds) if (!deliveredTo.has(id)) deliveredTo.set(id, new Set()); // ledger signal nobody received: no follow-ups
  }
  const sendRetry = async (chatId: string, text: string, opts: SendOpts): Promise<SendResult> => {
    let res = await tgSendDetailed(chatId, text, opts);
    if (!res.ok && res.retryAfter && res.retryAfter <= 10 && Date.now() - started < budgetMs) { await new Promise((ok) => setTimeout(ok, res.retryAfter! * 1000)); res = await tgSendDetailed(chatId, text, opts); }
    return res;
  };
  let sent = 0;
  for (const e of events) {
    if (Date.now() - started > budgetMs) break;
    const r = e.row;
    // "silent": the signal ended at TP1; the TP1 message says so, this only records that the end was handled.
    if (e.type === "lost" && e.end === "silent") { await sb.from("signal_followups").update({ lost_at: new Date().toISOString(), ...(r.zone_at || e.byWick ? {} : { closed_at: new Date().toISOString() }) }).eq("id", r.id); continue; } // after a TP1 wick the trade keeps being tracked to TP2, TP3 or the stop
    const { text, close } = message(e);
    const patch: Record<string, unknown> = { [`${e.type === "expired" ? "closed" : e.type}_at`]: new Date().toISOString() };
    if (close) patch.closed_at = new Date().toISOString();
    await sb.from("signal_followups").update(patch).eq("id", r.id);
    if (e.type === "lost") await notifyJournal(sb, r, e).catch(() => {});
    const listed = listingsUnknown ? ([...VENUE_IDS] as VenueId[]) : venuesFor(r.symbol, listings, null);
    const kb: Keyboard = [[{ text: "🔎 Full card", callback_data: `setup:${r.coingecko_id.length <= 36 ? r.coingecko_id : `~${r.symbol}`}:${r.timeframe}` }, ...(link("/") ? [{ text: "🌐 Full page", url: link(`/s/${r.coingecko_id}/${r.timeframe}`)! }, { text: "Journal", url: link("/setups")! }] : [])]];
    // TP2 and TP3 come with a shareable result card (rendered once, then Telegram's file id is reused).
    let card: Blob | string | null = null;
    if ((e.type === "tp2" || e.type === "tp3") && link("/")) {
      const lvl = e.type === "tp2" ? r.tp2 : r.tp3;
      card = await fetchImage(link(`/api/result-card?${new URLSearchParams({ symbol: r.symbol, tf: r.timeframe, side: r.side, entry: String((Number(r.entry_low) + Number(r.entry_high)) / 2), exit: String(lvl), sl: String(r.sl1 ?? ""), level: e.type.toUpperCase(), hours: String((Date.now() - Date.parse(r.emitted_at)) / 3_600_000) })}`)!);
    }
    const got = r.signal_id ? deliveredTo.get(r.signal_id) : undefined;
    const targets = got ? recipients.filter((rc) => got.has(rc.chatId)) : recipients.filter((rc) => canReceive(rc, listed, r.side, { timeframe: r.timeframe, confidence: r.confidence }));
    const log: Record<string, unknown>[] = [];
    for (const rc of targets) {
      if (card) {
        const id = await tgPhoto(rc.chatId, card, text.length <= 1000 ? text : text.slice(0, 990), kb);
        if (id) { card = id; sent++; log.push({ followup_id: r.id, signal_id: r.signal_id ?? null, event: e.type, recipient: rc.chatId, status: "sent", reason: "Sent with result card" }); await new Promise((res) => setTimeout(res, 50)); continue; }
      }
      const res = await sendRetry(rc.chatId, text, { html: true, keyboard: kb });
      if (res.ok) sent++;
      log.push({ followup_id: r.id, signal_id: r.signal_id ?? null, event: e.type, recipient: rc.chatId, status: res.ok ? "sent" : "failed", reason: res.ok ? "Sent" : `Telegram: ${(res.error ?? "unknown error").slice(0, 250)}` });
      await new Promise((res) => setTimeout(res, 50));
    }
    if (log.length) {
      const { error: le } = await sb.from("followup_messages").insert(log);
      if (le) console.error(`[followups] could not log ${log.length} ${e.type} message(s) for ${r.symbol}: ${le.message}`);
    }
  }
  return { checked: rows.length, events: events.length, sent };
}

/** People who logged this trade on the website but have no Telegram linked get the cancellation in the app (bell and push). */
async function notifyJournal(sb: SupabaseClient, r: any, e: Event) {
  const { data: taken } = await sb.from("saved_setups").select("user_id").eq("asset_key", r.asset_key).eq("timeframe", r.timeframe).eq("side", r.side).eq("status", "open").gt("created_at", r.emitted_at).limit(200);
  const users = [...new Set((taken ?? []).map((t: any) => t.user_id as string))];
  if (!users.length) return;
  const { data: profs } = await sb.from("profiles").select("id, telegram_chat_id").in("id", users);
  const why = END_LABEL[e.end ?? ""] ?? "it no longer passes the checks";
  for (const u of users) {
    if ((profs ?? []).find((x: any) => x.id === u)?.telegram_chat_id) continue; // already told on Telegram
    await deliver(sb, { userId: u, symbol: r.symbol, kind: "trade", title: `${r.symbol} ${r.side} ${r.timeframe}: Confirmed Trade cancelled`, body: `${why[0].toUpperCase()}${why.slice(1)}.${e.reason ? ` ${e.reason}` : ""} You logged this trade: tighten your stop or close it, and cancel any unfilled order.`, url: `/s/${r.coingecko_id}/${r.timeframe}` });
  }
}
