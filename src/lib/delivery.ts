/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 52 - the sender. The screener only queues signals (signals table). This reads the queue, decides for every
// recipient whether a signal goes out, and writes one decision row per recipient (sent, skipped, filtered or failed,
// each with a reason). It is resumable and idempotent: a recipient that already has a decision is never messaged
// again, and a run that runs out of time continues on the next tick. Nothing is skipped silently: every outcome is
// either a row in signal_deliveries or a row in signal_issues.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSendDetailed, tgCardImages, fetchImage, esc, type Keyboard, type SendOpts, type SendResult } from "./telegram";
import { venueListings, venuesFor, VENUE_IDS, VENUE_META, isVenueId, type VenueId } from "./venues";
import { caption, keyboard, mediaUrls, passesFilters, cleanFilters, filtersLabel, type ConfirmedSignal, type SignalFilters } from "./telegram-broadcast";
import { PRESETS, PRESET_IDS, specCheck, type PresetId, type SpecCandidate, type SpecContext } from "./ledger";
import { getMarketsByIds } from "./providers/coingecko";
import { safe } from "./fetch";
import { fmtUsd } from "./format";

export const QUEUE_HOURS = 6;
const LOOKBACK_MS = 10 * 86_400_000; // the grading window: open trades older than this are not counted as open
/** Telegram errors that will not change on retry (user blocked the bot, chat gone). */
const PERMANENT = /blocked|not found|deactivated|kicked|forbidden|can't initiate|have no rights/i;

type Status = "sent" | "skipped" | "filtered" | "failed";
export interface Decision { status: Status; reason: string }
export interface Recipient { id: string; group: boolean; venue: VenueId; filters?: SignalFilters; spec: PresetId; specTfs: string[] | null }
interface SpecState { sentToday: number; openSymbols: Set<string>; stoppedAt: Map<string, number>; openCount: number }
export interface DeliverReport { expired: number; processed: number; left: number; sent: number; decided: number; retried: number; issues: number }

/** Read every row of a query, one page of 1000 at a time (the API returns at most 1000 rows per request). */
export async function selectAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** The same, for a list of ids, in chunks of 200 so the request stays small. */
export async function selectIn<T>(ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    out.push(...(await selectAll((a, b) => q(chunk, a, b))));
  }
  return out;
}

/** Record a problem or a skip that has no recipient attached, so it is never silent. */
export async function issue(sb: SupabaseClient, signalId: string | null, stage: string, reason: string): Promise<void> {
  const { error } = await sb.from("signal_issues").insert({ signal_id: signalId, stage, reason: reason.slice(0, 500) });
  if (error) console.error(`[ledger] could not log issue (${stage}): ${reason} :: ${error.message}`);
}

/** Set a one-time stamp (broadcast_at, processed_at). The database refuses to change it afterwards. */
async function stamp(sb: SupabaseClient, id: string, col: "broadcast_at" | "processed_at"): Promise<void> {
  const { error } = await sb.from("signals").update({ [col]: new Date().toISOString() }).eq("id", id).is(col, null);
  if (error) console.error(`[ledger] could not set ${col} on ${id}: ${error.message}`);
}

export async function loadRecipients(sb: SupabaseClient): Promise<Recipient[]> {
  // A missing column is an error, not a fallback: sending without the filters would break people's own settings.
  const u = await sb.from("telegram_users").select("tg_user_id, venue, sig_filters, spec_preset, spec_tfs").eq("broadcast", true);
  if (u.error) throw new Error(`telegram_users: ${u.error.message} (run supabase/schema.sql once)`);
  const g = await sb.from("telegram_chats").select("chat_id, sig_filters").eq("broadcast", true);
  if (g.error) throw new Error(`telegram_chats: ${g.error.message} (run supabase/schema.sql once)`);
  return [
    ...(u.data ?? []).map((x: any): Recipient => ({
      id: String(x.tg_user_id), group: false,
      venue: (isVenueId(x.venue) ? x.venue : "binance") as VenueId,
      filters: cleanFilters(x.sig_filters),
      spec: (PRESET_IDS as string[]).includes(x.spec_preset) ? (x.spec_preset as PresetId) : "off",
      specTfs: Array.isArray(x.spec_tfs) && x.spec_tfs.length ? x.spec_tfs : null,
    })),
    ...(g.data ?? []).map((x: any): Recipient => ({ id: String(x.chat_id), group: true, venue: "binance", filters: cleanFilters(x.sig_filters), spec: "off", specTfs: null })),
  ];
}

/** What each speculative subscriber already has: today's count, open trades and recent stops (for the presets' limits). */
async function loadSpecState(sb: SupabaseClient, nowMs: number, ids: string[]): Promise<Map<string, SpecState>> {
  const state = new Map<string, SpecState>();
  for (const id of ids) state.set(id, { sentToday: 0, openSymbols: new Set(), stoppedAt: new Map(), openCount: 0 });
  if (!ids.length) return state;
  const dayStart = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00Z");
  const sent = await selectAll<any>((a, b) => sb.from("signal_deliveries").select("id, recipient, channel, signal_id, created_at").eq("status", "sent").gte("created_at", new Date(nowMs - LOOKBACK_MS).toISOString()).in("recipient", ids).order("id", { ascending: true }).range(a, b));
  const sigIds = [...new Set(sent.map((d) => d.signal_id as string))];
  const sigs = await selectIn<any>(sigIds, (ch, a, b) => sb.from("signals").select("id, symbol, created_at").in("id", ch).order("id", { ascending: true }).range(a, b));
  const outs = await selectIn<any>(sigIds, (ch, a, b) => sb.from("signal_outcomes").select("signal_id, outcome, exit_at").in("signal_id", ch).order("signal_id", { ascending: true }).range(a, b));
  const sigOf = new Map(sigs.map((s) => [s.id, s]));
  const outOf = new Map(outs.map((o) => [o.signal_id, o]));
  for (const d of sent) {
    const st = state.get(d.recipient), s = sigOf.get(d.signal_id), o = outOf.get(d.signal_id);
    if (!st || !s) continue;
    if (d.channel === "speculative" && Date.parse(d.created_at) >= dayStart) st.sentToday++;
    if (!o && Date.parse(s.created_at) > nowMs - LOOKBACK_MS) { st.openSymbols.add(s.symbol); st.openCount++; }
    if (o?.outcome === "stop" && o.exit_at) st.stoppedAt.set(s.symbol, Math.max(Date.parse(o.exit_at), st.stoppedAt.get(s.symbol) ?? 0));
  }
  return state;
}

/** Confirmed Trades: the member's own filters, then whether the exchange can take the trade. null = send. */
export function decideConfirmed(r: Recipient, sig: any, listed: VenueId[]): Decision | null {
  if (!passesFilters(r.filters, { timeframe: sig.timeframe, side: sig.side, confidence: sig.confidence })) return { status: "filtered", reason: `Your filter: ${filtersLabel(r.filters)}` };
  if (r.group) return listed.length ? null : { status: "skipped", reason: "Not listed on any exchange the bot scans" };
  if (!listed.includes(r.venue)) return { status: "skipped", reason: `Not listed on ${VENUE_META[r.venue].label}` };
  if (sig.side === "SHORT" && !VENUE_META[r.venue].canShort) return { status: "skipped", reason: `SHORT on ${VENUE_META[r.venue].label}, which is spot only` };
  return null;
}

/** Speculative alerts: the exchange checks, then the member's preset (and timeframe picks). null = send. */
export function decideSpec(r: Recipient, sig: any, listed: VenueId[], live: Map<string, number>, st: SpecState | undefined, nowMs: number): Decision | null {
  const vm = VENUE_META[r.venue];
  if (!listed.includes(r.venue)) return { status: "skipped", reason: `Not listed on ${vm.label}` };
  if (sig.side === "SHORT" && !vm.canShort) return { status: "skipped", reason: `SHORT on ${vm.label}, which is spot only` };
  const preset = PRESETS[r.spec as Exclude<PresetId, "off">];
  const cand: SpecCandidate = {
    symbol: sig.symbol, timeframe: sig.timeframe, side: sig.side,
    entry_mid: Number(sig.entry_mid), sl1: Number(sig.sl1),
    rr_tp2: sig.rr_tp2 != null ? Number(sig.rr_tp2) : null, confidence: sig.confidence ?? null,
    htf_aligned: sig.htf_aligned ?? null, market_rank: sig.market_rank ?? null,
    volume_24h: sig.volume_24h != null ? Number(sig.volume_24h) : null,
  };
  const ctx: SpecContext = {
    nowMs, livePrice: live.get(sig.coingecko_id) ?? null, userTfs: r.specTfs,
    sentToday: st?.sentToday ?? 0, openSymbols: st?.openSymbols ?? new Set(), stoppedAt: st?.stoppedAt ?? new Map(), openCount: st?.openCount ?? 0,
  };
  const c = specCheck(preset, cand, ctx);
  return c.ok ? null : { status: "filtered", reason: `${preset.label} preset: ${c.reason}` };
}

function sameBet(sig: any, openFu: any[], queue: any[]): string[] {
  const others = new Set<string>();
  for (const o of openFu) if (o.side === sig.side && o.symbol !== sig.symbol) others.add(`${o.symbol} ${o.timeframe}`);
  for (const o of queue) if (o !== sig && o.kind === "confirmed" && o.side === sig.side && o.symbol !== sig.symbol) others.add(`${o.symbol} ${o.timeframe}`);
  return [...others].slice(0, 4);
}

/** Text for a speculative alert: clearly labelled as not confirmed, with the same plan block as a Confirmed Trade. */
export function specText(p: ConfirmedSignal, venue: VenueId): string {
  const s = p.setup; const vm = VENUE_META[venue];
  const head = `🔍 <b>SPECULATIVE SETUP</b> (not confirmed yet)\n<b>${esc(p.symbol)}</b> ${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(p.timeframe)} · score ${s.confidence}/100 · ${s.riskRewardTp2}R\nOn ${esc(vm.label)}${vm.canShort ? "" : " (spot)"}`;
  const block = [
    `${p.symbol} ${s.side} ${p.timeframe} - SPECULATIVE - AsheSignal`,
    `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`,
    ...s.takeProfits.slice(0, 3).map((t) => `${t.label}: ${fmtUsd(t.price)} (${t.rr}R)`),
    ...s.stopLosses.map((t) => `${t.label}: ${fmtUsd(t.price)}`),
    `Price at signal: ${fmtUsd(p.price)}`,
  ].join("\n");
  return `${head}\n<pre>${esc(block)}</pre>\nThe engine has not confirmed this yet, so it can fail. Check the chart first. Manual trading only. Not financial advice.`;
}

async function openFollowup(sb: SupabaseClient, sig: any, p: ConfirmedSignal): Promise<void> {
  const { data: existing } = await sb.from("signal_followups").select("id").eq("asset_key", sig.asset_key).eq("timeframe", sig.timeframe).is("closed_at", null).limit(1);
  if (existing?.length) { await issue(sb, sig.id, "followup", `a lifecycle record is already open for ${sig.symbol} ${sig.timeframe}: TP and stop messages stay on that one`); return; }
  const { error } = await sb.from("signal_followups").insert({
    signal_id: sig.id, asset_key: sig.asset_key, coingecko_id: sig.coingecko_id, symbol: sig.symbol, timeframe: sig.timeframe, side: sig.side,
    entry_low: sig.entry_low, entry_high: sig.entry_high, tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3, sl1: sig.sl1, confidence: sig.confidence, last_price: p.price,
  });
  if (error) await issue(sb, sig.id, "followup", `lifecycle record not saved: ${error.message}`);
}

async function record(sb: SupabaseClient, signalId: string, recipient: string, channel: string, d: Decision): Promise<boolean> {
  const { error } = await sb.from("signal_deliveries").insert({ signal_id: signalId, recipient, channel, status: d.status, reason: d.reason.slice(0, 300) });
  if (error) { await issue(sb, signalId, "record", `decision for ${recipient} (${d.status}) not saved: ${error.message}`); return false; }
  return true;
}

/** One pass over the queue. Safe to call on every tick; finished signals are never touched again. */
export async function deliverQueued(sb: SupabaseClient, budgetMs = 40_000): Promise<DeliverReport> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const rep: DeliverReport = { expired: 0, processed: 0, left: 0, sent: 0, decided: 0, retried: 0, issues: 0 };
  const cutoff = new Date(started - QUEUE_HOURS * 3_600_000).toISOString();

  // 1. Anything older than the window that never finished is closed, and the reason is logged.
  const { data: stale, error: staleErr } = await sb.from("signals").select("id").is("processed_at", null).lt("created_at", cutoff).limit(100);
  if (staleErr) throw new Error(`signals: ${staleErr.message}`);
  for (const s of stale ?? []) {
    await issue(sb, s.id, "expire", `not finished within ${QUEUE_HOURS}h: recipients without a decision row were never reached`);
    await stamp(sb, s.id, "processed_at");
    rep.expired++; rep.issues++;
  }

  // 2. The queue, oldest first.
  const { data: queue, error: qErr } = await sb.from("signals").select("*").is("processed_at", null).gte("created_at", cutoff).order("created_at", { ascending: true }).limit(40);
  if (qErr) throw new Error(`signals: ${qErr.message}`);
  if (!queue?.length) return rep;

  const recipients = await loadRecipients(sb);
  const listings = await venueListings();
  const listingsUnknown = Object.values(listings).every((set) => !set || set.size === 0);
  const specRecipients = recipients.filter((r) => !r.group && r.spec !== "off");
  const specState = await loadSpecState(sb, started, specRecipients.map((r) => r.id));
  const live = new Map<string, number>();
  const specIds = queue.filter((q) => q.kind === "speculative").map((q) => q.coingecko_id as string);
  if (specIds.length) {
    const mk = await safe(getMarketsByIds([...new Set(specIds)]));
    if (mk.ok) for (const m of mk.data) if (m.priceUsd) live.set(m.id, m.priceUsd);
  }
  const { data: openFu } = await sb.from("signal_followups").select("symbol, side, timeframe").is("closed_at", null).is("sl_at", null).is("lost_at", null).gt("emitted_at", new Date(started - 36 * 3_600_000).toISOString()).limit(200);

  for (const sig of queue) {
    if (Date.now() > deadline) { rep.left++; continue; }
    const p = sig.payload as ConfirmedSignal;
    const listed = listingsUnknown ? ([...VENUE_IDS] as VenueId[]) : venuesFor(sig.symbol, listings, null);
    const { data: done, error: dErr } = await sb.from("signal_deliveries").select("recipient").eq("signal_id", sig.id);
    if (dErr) { await issue(sb, sig.id, "send", `could not read earlier decisions: ${dErr.message}`); rep.issues++; rep.left++; continue; }
    const decided = new Set((done ?? []).map((d: any) => d.recipient as string));
    const candidates = sig.kind === "confirmed" ? recipients : specRecipients;
    if (!candidates.length) { await issue(sb, sig.id, "recipients", sig.kind === "confirmed" ? "no member or group has Confirmed Trades switched on" : "no member has speculative alerts on"); rep.issues++; }

    const same = sameBet(sig, openFu ?? [], queue);
    let media: { card?: Blob | string | null; chart?: Blob | string | null } | null = null;
    let complete = true, sentHere = 0;

    const sendRetry = async (chatId: string, text: string, opts: SendOpts): Promise<SendResult> => {
      let res = await tgSendDetailed(chatId, text, opts);
      for (let i = 0; i < 2 && !res.ok && res.retryAfter && Date.now() + res.retryAfter * 1000 < deadline; i++) {
        rep.retried++;
        await new Promise((resolve) => setTimeout(resolve, res.retryAfter! * 1000));
        res = await tgSendDetailed(chatId, text, opts);
      }
      return res;
    };

    for (const r of candidates) {
      if (decided.has(r.id)) continue;
      if (Date.now() > deadline) { complete = false; break; }
      const d = sig.kind === "confirmed" ? decideConfirmed(r, sig, listed) : decideSpec(r, sig, listed, live, specState.get(r.id), started);
      if (d) { if (await record(sb, sig.id, r.id, sig.kind, d)) rep.decided++; continue; }

      // Eligible: send it.
      const venue = r.group ? (listed[0] ?? "binance") : r.venue;
      let res: SendResult;
      if (sig.kind === "confirmed") {
        if (!media) {
          const urls = mediaUrls(p);
          const [card, chart] = await Promise.all([urls.og ? fetchImage(urls.og) : null, urls.chart ? fetchImage(urls.chart) : null]);
          media = { card, chart };
        }
        const kb: Keyboard = keyboard(p, venue, listed);
        const og = mediaUrls(p).og;
        if (og) kb.push([{ text: "🖼 Open share card", url: og }]);
        const header = `✅ <b>NEW CONFIRMED: ${esc(sig.symbol)} ${sig.side} ${esc(sig.timeframe)}</b>`;
        const imgIds: { card?: string; chart?: string } | null = await tgCardImages(r.id, media, header).catch(() => null);
        if (imgIds) media = { card: imgIds.card ?? media.card, chart: imgIds.chart ?? media.chart };
        res = await sendRetry(r.id, caption(p, venue, listed, r.group, same), { html: true, keyboard: kb });
      } else {
        res = await sendRetry(r.id, specText(p, venue), { html: true, keyboard: keyboard(p, venue, listed) });
      }

      if (res.ok) {
        sentHere++; rep.sent++;
        if (await record(sb, sig.id, r.id, sig.kind, { status: "sent", reason: sig.kind === "confirmed" ? "Sent" : "Sent as a speculative alert" })) rep.decided++;
        const st = specState.get(r.id);
        if (sig.kind === "speculative" && st) { st.sentToday++; st.openCount++; st.openSymbols.add(sig.symbol); }
      } else if (PERMANENT.test(res.error ?? "")) {
        if (await record(sb, sig.id, r.id, sig.kind, { status: "failed", reason: `Telegram refused: ${res.error}` })) rep.decided++;
      } else {
        complete = false; rep.issues++;
        await issue(sb, sig.id, "send", `${r.id}: will retry on the next tick (${res.error ?? "unknown error"})`);
      }
    }

    if (sentHere && !sig.broadcast_at) {
      await stamp(sb, sig.id, "broadcast_at");
      if (sig.kind === "confirmed") await openFollowup(sb, sig, p);
    }
    if (complete) { await stamp(sb, sig.id, "processed_at"); rep.processed++; } else rep.left++;
  }
  return rep;
}
