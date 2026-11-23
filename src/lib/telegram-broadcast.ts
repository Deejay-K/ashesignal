// Automatic Telegram signal: one message per newly Confirmed trade, with the share card attached and the
// full copy-trade text, sent to every Telegram user and group that has signals on. Filtered per user by
// their exchange (spot-only exchanges never receive SHORTs). Nothing here places orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import { TELEGRAM_ENABLED, tgSend, tgCardImages, fetchImage, esc, type Keyboard } from "./telegram";
import { venueListings, venuesFor, tradeLink, VENUE_META, VENUE_IDS, isVenueId, type VenueId } from "./venues";
import { fmtUsd } from "./format";
import type { Setup } from "./ta/analysis";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (path: string) => (SITE() ? `${SITE()}${path}` : undefined);

export interface ConfirmedSignal { coingeckoId: string; symbol: string; name: string; timeframe: string; price: number; setup: Setup; qualifies: string[] }

/** Plain-text block a trader pastes anywhere (same vocabulary as the website's Copy Trade Setup). */
export function signalCopyText(sig: ConfirmedSignal, venue: VenueId, listed: VenueId[]): string {
  const s = sig.setup; const vm = VENUE_META[venue];
  const lines = [
    `${sig.symbol} ${s.side} ${sig.timeframe} - CONFIRMED - AsheSignal`,
    `Pair on ${vm.label}: ${vm.instrument(sig.symbol, vm.quotes[0])}${listed.filter((v) => v !== venue).length ? ` (also: ${listed.filter((v) => v !== venue).map((v) => VENUE_META[v].label).join(", ")})` : ""}`,
    `Price now: ${fmtUsd(sig.price)}`,
    `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`,
    ...s.takeProfits.slice(0, 3).map((t) => `${t.label}: ${fmtUsd(t.price)} (${t.rr}R)`),
    ...s.stopLosses.map((t) => `${t.label}: ${fmtUsd(t.price)}`),
    `R:R to TP2: ${s.riskRewardTp2}R - Setup score: ${s.confidence}/100 (how many checks lined up, not a win chance)`,
    `Leverage: ${s.leverage.recommended}x recommended (max ${s.leverage.maxSafe}x)${vm.canShort ? "" : " - spot: 1x"}`,
    `Size: risk 1% of account between entry and SL1`,
    `Plan: limit order in the zone, stop attached, take 30/30/40 at TP1/2/3, stop to break-even after TP1`,
  ];
  return lines.join("\n");
}

export function keyboard(sig: ConfirmedSignal, venue: VenueId, listed: VenueId[]): Keyboard {
  const s = sig.setup; const id = sig.coingeckoId.length <= 36 ? sig.coingeckoId : `~${sig.symbol}`; const tf = sig.timeframe;
  const guide = link(`/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), symbol: sig.symbol, leverage: String(s.leverage.recommended), venue })}`);
  const tv = listed.includes(venue) ? venue : listed[0];
  const kb: Keyboard = [
    [{ text: "✍️ I took it", callback_data: `take:${id}:${tf}:real` }, { text: "🧪 Paper", callback_data: `take:${id}:${tf}:paper` }, { text: "📐 Size", callback_data: `size:${s.entry.mid}:${s.stopLosses[0].price}` }],
    [{ text: "🔔 TP1/SL alerts", callback_data: `alerttp:${id}:${tf}` }, { text: "🔔 Entering zone", callback_data: `zonealert:${id}:${tf}` }, { text: "⭐ Watch", callback_data: `watch:${id}` }],
  ];
  const row: Keyboard[number] = [];
  if (guide) row.push({ text: "📖 How to place it", url: guide });
  if (tv) row.push({ text: `↗ Open on ${VENUE_META[tv].label}`, url: tradeLink(tv, sig.symbol) });
  if (row.length) kb.push(row);
  kb.push([{ text: "🔎 Full card", callback_data: `setup:${id}:${tf}` }, ...(link("/") ? [{ text: "🌐 Full page", url: link(`/s/${sig.coingeckoId}/${tf}`)! }] : [])]);
  return kb;
}

export function caption(sig: ConfirmedSignal, venue: VenueId, listed: VenueId[], forGroup: boolean, same: string[] = []): string {
  const s = sig.setup; const vm = VENUE_META[venue];
  const head = `✅ <b>NEW CONFIRMED TRADE</b>\n<b>${esc(sig.symbol)}</b> ${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(sig.timeframe)} · score ${s.confidence}/100 · ${s.riskRewardTp2}R${forGroup ? `\nListed on: ${listed.map((v) => VENUE_META[v].label).join(", ") || "DEX only"}` : `\nOn ${esc(vm.label)}${vm.canShort ? "" : " (spot)"}`}`;
  const why = sig.qualifies[0] ? `\n${esc(sig.qualifies[0])}` : "";
  const pre = `\n<pre>${esc(signalCopyText(sig, venue, listed))}</pre>`;
  const bet = same.length ? `\n⚠️ <b>Same bet as ${esc(same.join(", "))}</b> (${s.side === "LONG" ? "long" : "short"}, still open). These coins move together: split your 1% risk between them, do not stack it.` : "";
  const foot = `\nLong-press the block to copy. Manual trading only. Not financial advice.`;
  let out = head + why + bet + pre + foot;
  if (out.length > 1000) out = head + bet + pre + foot; // Telegram caption limit is 1024
  if (out.length > 1000) out = head + pre + foot;
  return out;
}

/** The chart and the share-card image links for a signal (the same links the Telegram card uses). */
export function mediaUrls(sig: ConfirmedSignal): { chart?: string; og?: string } {
  const chart = link(`/api/chart?${new URLSearchParams({ symbol: sig.symbol, id: sig.coingeckoId, tf: sig.timeframe, side: sig.setup.side, entryLow: String(sig.setup.entry.low), entryHigh: String(sig.setup.entry.high), tp1: String(sig.setup.takeProfits[0]?.price ?? ""), tp2: String(sig.setup.takeProfits[1]?.price ?? ""), tp3: String(sig.setup.takeProfits[2]?.price ?? ""), sl1: String(sig.setup.stopLosses[0].price), sl2: String(sig.setup.stopLosses[1]?.price ?? "") })}`);
  const og = link(`/api/og?${new URLSearchParams({ symbol: sig.symbol, tf: sig.timeframe, side: sig.setup.side, kind: "confirmed", entryLow: String(sig.setup.entry.low), entryHigh: String(sig.setup.entry.high), tp1: String(sig.setup.takeProfits[0]?.price ?? ""), tp2: String(sig.setup.takeProfits[1]?.price ?? ""), tp3: String(sig.setup.takeProfits[2]?.price ?? ""), sl1: String(sig.setup.stopLosses[0].price), sl2: String(sig.setup.stopLosses[1]?.price ?? sig.setup.stopLosses[0].price), rr: String(sig.setup.riskRewardTp2), lev: String(sig.setup.leverage.recommended), conf: String(sig.setup.confidence), style: sig.setup.style, theme: "foundry" })}`);
  return { chart, og };
}

/** Per-person (or per-group) choice of which signals to receive. Empty = everything, as before. */
export interface SignalFilters { tfs?: string[]; longsOnly?: boolean; minScore?: number }
export const FILTER_TFS = ["1h", "4h", "1d"] as const;
export function cleanFilters(v: unknown): SignalFilters {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: SignalFilters = {};
  if (Array.isArray(o.tfs)) { const t = o.tfs.filter((x): x is string => typeof x === "string" && (FILTER_TFS as readonly string[]).includes(x)); if (t.length && t.length < FILTER_TFS.length) out.tfs = t; }
  if (o.longsOnly === true) out.longsOnly = true;
  const m = Number(o.minScore); if (Number.isFinite(m) && m > 0 && m <= 95) out.minScore = Math.round(m);
  return out;
}
/** Does a signal pass someone's personal filters? */
export function passesFilters(f: SignalFilters | undefined, sig: { timeframe: string; side: string; confidence?: number | null }): boolean {
  if (!f) return true;
  if (f.tfs?.length && !f.tfs.includes(sig.timeframe)) return false;
  if (f.longsOnly && sig.side !== "LONG") return false;
  if (f.minScore && sig.confidence != null && sig.confidence < f.minScore) return false;
  return true;
}
export function filtersLabel(f: SignalFilters | undefined): string {
  if (!f || (!f.tfs && !f.longsOnly && !f.minScore)) return "all Confirmed Trades";
  return [f.tfs ? `${f.tfs.join(", ")} only` : "all timeframes", f.longsOnly ? "longs only" : "longs and shorts", f.minScore ? `score ${f.minScore}+` : "any score"].join(" · ");
}
export interface Recipient { chatId: string; venue: VenueId; group: boolean; filters?: SignalFilters }
export function recipientsFrom(users: any[] | null, groups: any[] | null): Recipient[] {
  return [
    ...(users ?? []).map((u) => ({ chatId: String(u.tg_user_id), venue: (isVenueId(u.venue) ? u.venue : "binance") as VenueId, group: false, filters: cleanFilters(u.sig_filters) })),
    ...(groups ?? []).map((g) => ({ chatId: String(g.chat_id), venue: "binance" as VenueId, group: true, filters: cleanFilters(g.sig_filters) })),
  ];
}
/** Everyone with signals switched on. Falls back to the old columns if schema.sql has not been re-run yet. */
async function loadRaw(sb: SupabaseClient): Promise<{ users: any[] | null; groups: any[] | null }> {
  const [u, g] = await Promise.all([
    sb.from("telegram_users").select("tg_user_id, venue, sig_filters").eq("broadcast", true),
    sb.from("telegram_chats").select("chat_id, sig_filters").eq("broadcast", true),
  ]);
  const users = u.error ? (await sb.from("telegram_users").select("tg_user_id, venue").eq("broadcast", true)).data : u.data;
  const groups = g.error ? (await sb.from("telegram_chats").select("chat_id").eq("broadcast", true)).data : g.data;
  return { users, groups };
}
export async function loadRecipients(sb: SupabaseClient): Promise<Recipient[]> {
  const { users, groups } = await loadRaw(sb);
  return recipientsFrom(users, groups);
}
/** Who should hear about a coin: everyone with signals on whose exchange lists it (SHORTs skipped on spot-only). */
export function canReceive(r: Recipient, listed: VenueId[], side: "LONG" | "SHORT", sig?: { timeframe: string; confidence?: number | null }): boolean {
  if (sig && !passesFilters(r.filters, { ...sig, side })) return false;
  if (r.group) return listed.length > 0;
  if (!listed.includes(r.venue)) return false;
  if (side === "SHORT" && !VENUE_META[r.venue].canShort) return false;
  return true;
}

/**
 * Send one message per confirmed signal to every opted-in Telegram user (by exchange) and group.
 * Returns how many messages went out. Capped so a full re-screen cannot flood.
 */
export async function broadcastConfirmed(sb: SupabaseClient, signals: ConfirmedSignal[], opts: { maxMessages?: number; onlyChat?: string; test?: boolean } = {}): Promise<{ sent: number; recipients: number; skipped: number }> {
  if (!TELEGRAM_ENABLED() || !signals.length) return { sent: 0, recipients: 0, skipped: 0 };
  const [{ users, groups }, listings] = await Promise.all([loadRaw(sb), venueListings()]);
  // "Same bet" check: other Confirmed Trades in the same direction that are still open (or in this same batch).
  // Crypto majors move together, so two shorts are one idea with double the risk unless the size is split.
  const { data: openNow } = opts.test ? { data: [] as any[] } : await sb.from("signal_followups").select("symbol, side, timeframe, emitted_at").is("closed_at", null).is("sl_at", null).is("lost_at", null).gt("emitted_at", new Date(Date.now() - 36 * 3_600_000).toISOString()).limit(50);
  const sameBet = (sig: ConfirmedSignal): string[] => {
    const others = new Set<string>();
    for (const o of openNow ?? []) if (o.side === sig.setup.side && o.symbol !== sig.symbol) others.add(`${o.symbol} ${o.timeframe}`);
    for (const o of signals) if (o !== sig && o.setup.side === sig.setup.side && o.symbol !== sig.symbol) others.add(`${o.symbol} ${o.timeframe}`);
    return [...others].slice(0, 4);
  };
  let recipients = recipientsFrom(users, groups);
  if (opts.onlyChat) recipients = recipients.filter((r) => r.chatId === opts.onlyChat);
  // Remember each broadcast so the follow-up worker can report zone entry, TP1, TP2, SL and lost confirmation.
  if (!opts.onlyChat && !opts.test) for (const sig of signals) {
    const { data: existing } = await sb.from("signal_followups").select("id").eq("asset_key", `cg:${sig.coingeckoId}`).eq("timeframe", sig.timeframe).is("closed_at", null).limit(1);
    if (!existing?.length) await sb.from("signal_followups").insert({ asset_key: `cg:${sig.coingeckoId}`, coingecko_id: sig.coingeckoId, symbol: sig.symbol, timeframe: sig.timeframe, side: sig.setup.side, entry_low: sig.setup.entry.low, entry_high: sig.setup.entry.high, tp1: sig.setup.takeProfits[0]?.price ?? null, tp2: sig.setup.takeProfits[1]?.price ?? null, tp3: sig.setup.takeProfits[2]?.price ?? null, sl1: sig.setup.stopLosses[0]?.price ?? null, confidence: sig.setup.confidence, last_price: sig.price });
  }
  if (!recipients.length) return { sent: 0, recipients: 0, skipped: 0 };
  const max = opts.maxMessages ?? 60;
  // If every listing fetch failed we cannot know where a coin trades; do not silently drop the signal.
  const listingsUnknown = Object.values(listings).every((set) => !set || set.size === 0);
  let sent = 0, skipped = 0;
  for (const sig of signals) {
    const listed = listingsUnknown ? ([...VENUE_IDS] as VenueId[]) : venuesFor(sig.symbol, listings, null);
    const { chart, og } = mediaUrls(sig);
    // Render both images once per signal; after the first upload Telegram's file_ids are reused for everyone else.
    const [cardBlob, chartBlob] = await Promise.all([og ? fetchImage(og) : null, chart ? fetchImage(chart) : null]);
    let imgs: { card?: Blob | string | null; chart?: Blob | string | null } = { card: cardBlob, chart: chartBlob };
    for (const r of recipients) {
      if (sent >= max) return { sent, recipients: recipients.length, skipped };
      if (!opts.onlyChat && !passesFilters(r.filters, { timeframe: sig.timeframe, side: sig.setup.side, confidence: sig.setup.confidence })) { skipped++; continue; } // their own filters
      if (!r.group) {
        if (!listed.includes(r.venue)) { skipped++; continue; }           // not tradeable on their exchange
        if (sig.setup.side === "SHORT" && !VENUE_META[r.venue].canShort) { skipped++; continue; } // spot only
      } else if (!listed.length) { skipped++; continue; }
      const venue = r.group ? (listed[0] ?? "binance") : r.venue;
      const text = caption(sig, venue, listed, r.group, sameBet(sig));
      const kb = keyboard(sig, venue, listed);
      if (og) kb.push([{ text: "🖼 Open share card", url: og }]);
      const ids = await tgCardImages(r.chatId, imgs, `✅ <b>NEW CONFIRMED: ${esc(sig.symbol)} ${sig.setup.side} ${esc(sig.timeframe)}</b>`);
      if (ids) imgs = { card: ids.card ?? imgs.card, chart: ids.chart ?? imgs.chart };
      const ok = await tgSend(r.chatId, text, { html: true, keyboard: kb });
      if (ok) sent++;
      await new Promise((res) => setTimeout(res, 60)); // stay under Telegram's ~30 msg/s
    }
  }
  return { sent, recipients: recipients.length, skipped };
}
