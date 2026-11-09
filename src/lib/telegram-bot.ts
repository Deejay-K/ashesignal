// The Telegram bot's brain: commands and button callbacks that mirror the app. Every number comes from the
// same engine functions the website uses. Nothing here places orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSend, tgPhoto, tgEdit, tgAnswerCallback, tgTyping, esc, linkCode, type Keyboard } from "./telegram";
import { answer } from "./ai/assistant";
import { globalConditions, summarize } from "./market/conditions";
import { marketRegime } from "./market/regime";
import { analyzeAsset } from "./market/analyze";
import { search as cgSearch, getMarketsByIds } from "./providers/coingecko";
import { getFearGreed } from "./providers/feargreed";
import { loadDiscovery, tradeableOn } from "./market/discovery";
import { sizePosition } from "./risk/position";
import { portfolioHeat } from "./risk/heat";
import { venueListings, venuesFor, VENUE_IDS, VENUE_META, isVenueId, type VenueId } from "./venues";
import { fmtUsd, fmtNum } from "./format";
import { zoneStatus, preTradeChecks, accountForChecks } from "./trade-check";
import { scanAddress } from "./market/scan";
import { buildSpecDetail } from "./market/speculative";
import { classifyAddress } from "./providers/chains";
import { buildWeeklyReview } from "./review";
import { digestShared, buildDigest } from "./digest";
import { safe } from "./fetch";
import type { Timeframe } from "./types";
import type { Opportunity } from "./market/opportunities";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (path: string) => (SITE() ? `${SITE()}${path}` : undefined);

export interface ChatCtx { sb: SupabaseClient; chatId: string; tgUserId: string; firstName?: string; userId: string | null; venue: VenueId; isGroup: boolean; state: any; messageId?: number }

const MENU: Keyboard = [
  [{ text: "✅ Confirmed trades", callback_data: "cat:confirmed" }, { text: "👀 Watching", callback_data: "cat:watching" }],
  [{ text: "⚠️ Speculative", callback_data: "cat:speculative" }, { text: "🏦 Spot picks", callback_data: "cat:spot" }],
  [{ text: "🌡 Today", callback_data: "today" }, { text: "📊 Screener", callback_data: "screener:score" }],
  [{ text: "🏆 Top 3 for me", callback_data: "top" }, { text: "⭐ Watchlist", callback_data: "watchlist" }],
  [{ text: "👤 My trades", callback_data: "me" }, { text: "🔔 Alerts", callback_data: "alerts" }],
  [{ text: "📅 Weekly review", callback_data: "review" }, { text: "☀️ Digest now", callback_data: "digest" }],
  [{ text: "⚙️ Settings", callback_data: "settings" }, { text: "❓ Help", callback_data: "help" }],
];

/**
 * Settings are per Telegram user, not per chat: in a group every member keeps their own exchange, account link
 * and guided flow. Falls back to the legacy profiles.telegram_chat_id link (private chat id = user id).
 */
export async function loadActor(sb: SupabaseClient, tgUserId: string, chatId: string, meta?: { firstName?: string; username?: string; chatTitle?: string }): Promise<{ userId: string | null; venue: VenueId; state: any }> {
  const { data } = await sb.from("telegram_users").select("*").eq("tg_user_id", tgUserId).maybeSingle();
  if (data) return { userId: data.user_id, venue: isVenueId(data.venue) ? data.venue : "binance", state: data.state ?? null };
  const { data: p } = await sb.from("profiles").select("id, preferences").eq("telegram_chat_id", tgUserId).maybeSingle();
  const venue: VenueId = isVenueId(p?.preferences?.venue) ? p!.preferences.venue : "binance";
  await sb.from("telegram_users").upsert({ tg_user_id: tgUserId, user_id: p?.id ?? null, venue, first_name: meta?.firstName ?? null, username: meta?.username ?? null });
  if (chatId !== tgUserId) await sb.from("telegram_chats").upsert({ chat_id: chatId, title: meta?.chatTitle ?? null, updated_at: new Date().toISOString() });
  return { userId: p?.id ?? null, venue, state: null };
}
const setState = (c: ChatCtx, state: any) => c.sb.from("telegram_users").update({ state, updated_at: new Date().toISOString() }).eq("tg_user_id", c.tgUserId);
let botUser: string | null | undefined;
async function botUsername(): Promise<string | null> {
  if (botUser !== undefined) return botUser;
  const { tgMe } = await import("./telegram");
  const me: any = await tgMe().catch(() => null);
  botUser = (me?.username ?? me?.result?.username ?? null) as string | null;
  return botUser ?? null;
}
const who = (c: ChatCtx) => (c.isGroup && c.firstName ? `${esc(c.firstName)}: ` : "");

const pct = (a: number, b: number) => `${(((a - b) / b) * 100) >= 0 ? "+" : ""}${(((a - b) / b) * 100).toFixed(2)}%`;

// ---------- handlers ----------

export async function handleCommand(c: ChatCtx, cmdRaw: string, arg: string, fullText: string) {
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  switch (cmd) {
    case "/start": {
      // Deep links from groups: /start take_<ref>_<tf>_<real|paper>
      const m = arg.match(/^take_(.+)_(1h|4h|1d|15m|1w)_(real|paper)$/i);
      if (m) return takeStart(c, m[1], m[2] as Timeframe, m[3].toLowerCase() === "paper");
      return sendMenu(c);
    }
    case "/menu": return sendMenu(c);
    case "/help": return help(c);
    case "/link": return linkAccount(c, arg);
    case "/unlink": return unlink(c);
    case "/trades": case "/confirmed": return category(c, "confirmed");
    case "/watching": return category(c, "watching");
    case "/spec": case "/speculative": return category(c, "speculative");
    case "/spot": return category(c, "spot");
    case "/today": case "/conditions": return today(c);
    case "/regime": return today(c);
    case "/coin": return coin(c, arg);
    case "/scan": case "/token": case "/ca": return scanCard(c, arg);
    case "/screener": return screener(c, arg || "score");
    case "/size": return size(c, arg);
    case "/alert": return alertCreate(c, arg);
    case "/alerts": return alertsList(c);
    case "/me": return me(c);
    case "/journal": return journal(c);
    case "/take": return takeStart(c, arg);
    case "/exchange": return exchange(c, arg);
    case "/watch": case "/star": return watchAdd(c, arg);
    case "/unwatch": return watchRemove(c, arg);
    case "/watchlist": return watchlist(c);
    case "/top": return top(c);
    case "/review": return review(c);
    case "/digest": return digestNow(c);
    case "/settings": return settings(c);
    case "/signals": return signals(c, arg);
    case "/guide": return tgSend(c.chatId, `<b>How to place a trade on ${esc(VENUE_META[c.venue].label)}</b>\nShort version: limit order inside the entry zone, stop loss attached, take-profits in parts (30/30/40), stop to break-even after TP1. The full click-by-click guide with your numbers opens from any setup card.${VENUE_META[c.venue].canShort ? "" : `\n\n${esc(VENUE_META[c.venue].label)} is spot only: SHORT setups cannot be opened there.`}`, { html: true, keyboard: [[{ text: "Open the trade guide", url: link(`/guide?venue=${c.venue}`) ?? "https://t.me" }]] });
    case "/cancel": await setState(c, null); return tgSend(c.chatId, "Cancelled.");
    case "/untake": case "/close": return me(c);
    default: return freeText(c, fullText);
  }
}

export async function handleCallback(c: ChatCtx, data: string, callbackId: string) {
  await tgAnswerCallback(callbackId);
  const [kind, a, b, d] = data.split(":");
  switch (kind) {
    case "menu": return sendMenu(c);
    case "cat": return category(c, a as any, Number(b ?? 0));
    case "today": return today(c);
    case "screener": return screener(c, a ?? "score");
    case "me": return me(c);
    case "alerts": return alertsList(c);
    case "help": return help(c);
    case "exchange": return a ? setExchange(c, a) : exchange(c, "");
    case "coin": return coin(c, a, (b as Timeframe) || undefined);
    case "setup": return setupCard(c, a, (b as Timeframe) || "4h");
    case "scan": return scanCard(c, a);
    case "wa": return whaleAlert(c, a);
    case "copy": return copySetup(c, a, (b as Timeframe) || "4h");
    case "take": return takeStart(c, a, (b as Timeframe) || "4h", d === "paper");
    case "alerttp": return alertFromSetup(c, a, (b as Timeframe) || "4h");
    case "confirmalert": return alertConfirm(c, a);
    case "zonealert": return alertZone(c, a, (b as Timeframe) || "4h");
    case "watch": return a === "rm" ? watchRemove(c, b) : watchAdd(c, a);
    case "watchlist": return watchlist(c);
    case "top": return top(c);
    case "review": return review(c);
    case "digest": return digestNow(c);
    case "settings": return a ? settingsSet(c, a, b) : settings(c);
    case "signals": return signals(c, a ?? "");
    case "takesave": return takeFinish(c, a === "yes");
    case "rm": return removeTrade(c, a, true);
    case "untake": return removeTrade(c, a, false);
    case "closeq": return closeStart(c, a);
    case "size": return size(c, `${a} ${b}`);
    default: return sendMenu(c);
  }
}

export async function handleStateReply(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state;
  if (!st?.flow) return false;
  if (st.flow === "take") return takeStep(c, text);
  if (st.flow === "close") return closeStep(c, text);
  return false;
}

// ---------- screens ----------

async function sendMenu(c: ChatCtx) {
  const vm = VENUE_META[c.venue];
  return tgSend(c.chatId, `<b>AsheSignal</b>${c.isGroup && c.firstName ? ` for ${esc(c.firstName)}` : ""}\nYour exchange: <b>${esc(vm.label)}</b>${vm.canShort ? "" : " (spot only, longs)"}${c.userId ? "" : "\nNot linked to an account: /link CODE from the Account page for journal, alerts and digest."}\n\nPick a section:`, { html: true, keyboard: MENU });
}

async function help(c: ChatCtx) {
  const lines = [
    "<b>Commands</b>",
    "/menu - buttons for everything",
    "/trades, /watching, /spec, /spot - the four discovery categories",
    "/today - conditions, regime, Fear & Greed",
    "/coin SOL [1h|4h|1d] - full analysis with setup card",
    "/scan ADDRESS - any token on any chain by contract address (Solana, Ethereum, Base, BNB, Polygon, Arbitrum, Avalanche, Optimism, Sui, TON...). Pasting an address also works.",
    "/screener [score|rsi|volume|oversold|overbought] - top coins",
    "/size ENTRY STOP [balance] [risk%] - position size",
    "/alert BTC above 100000 | below 90000 - price alert (linked)",
    "/alerts - your rules and inbox (linked)",
    "/me, /journal - your trades, heat, record (linked)",
    "/take SOL - record a trade you placed (linked), guided",
    "/me then Cancel or Close - undo a recorded trade, or close it at your exit price",
    "/top - the 3 best confirmed setups for your exchange right now",
    "/watch SOL, /unwatch SOL, /watchlist - your starred coins with status and zone",
    "/review - this week's review (linked)",
    "/digest - today's digest now (linked)",
    "/settings - exchange, digest on/off and hour, link status",
    "/signals on|off - automatic message for every new confirmed trade (per person; in a group, for the group)",
    "/exchange coinbase - your exchange (each person has their own, also in groups)",
    "Type @AsheSignalBot SOL in any chat to share a setup card inline.",
    "/guide - how to place a trade",
    "Or ask anything in plain words.",
    "",
    "Manual trading only. The bot never places orders. Not financial advice.",
  ];
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[{ text: "Menu", callback_data: "menu" }]] });
}

async function linkAccount(c: ChatCtx, arg: string) {
  const code = arg.toUpperCase().trim();
  if (!code) return tgSend(c.chatId, "Send /link followed by the 6-character code shown on your Account page (Telegram section).");
  const { data: owner } = await c.sb.from("profiles").select("id, preferences").eq("telegram_link_code", code).maybeSingle();
  if (!owner) return tgSend(c.chatId, "That code is not valid or was already used. Open the Account page, Telegram section, and use the new code.");
  // Deliveries (alerts, digest, review) go to the user's private chat with the bot, never to a group.
  await c.sb.from("profiles").update({ telegram_chat_id: c.tgUserId, telegram_link_code: null }).eq("id", owner.id);
  const venue: VenueId = isVenueId(owner.preferences?.venue) ? owner.preferences.venue : c.venue;
  await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, user_id: owner.id, venue, first_name: c.firstName ?? null, updated_at: new Date().toISOString() });
  c.userId = owner.id; c.venue = venue;
  await tgSend(c.chatId, `${who(c)}Linked. Exchange set to <b>${esc(VENUE_META[venue].label)}</b> from your account. Alerts, the daily digest and the weekly review arrive in your private chat with me${c.isGroup ? " (open @AsheSignalBot and press Start once so I am allowed to message you)" : ""}.`, { html: true });
  return sendMenu(c);
}
async function unlink(c: ChatCtx) {
  if (c.userId) await c.sb.from("profiles").update({ telegram_chat_id: null, telegram_link_code: linkCode() }).eq("id", c.userId);
  await c.sb.from("telegram_users").update({ user_id: null, state: null }).eq("tg_user_id", c.tgUserId);
  return tgSend(c.chatId, `${who(c)}Disconnected. Public data still works; link again any time.`, { html: true });
}

async function exchange(c: ChatCtx, arg: string): Promise<boolean> {
  if (arg && isVenueId(arg.toLowerCase())) return setExchange(c, arg.toLowerCase());
  return tgSend(c.chatId, `${who(c)}Your exchange: <b>${esc(VENUE_META[c.venue].label)}</b>. Pick another:`, { html: true, keyboard: [VENUE_IDS.slice(0, 3).map((v) => ({ text: (v === c.venue ? "• " : "") + VENUE_META[v].label, callback_data: `exchange:${v}` })), VENUE_IDS.slice(3).map((v) => ({ text: (v === c.venue ? "• " : "") + VENUE_META[v].label, callback_data: `exchange:${v}` }))] });
}
async function setExchange(c: ChatCtx, v: string): Promise<boolean> {
  if (!isVenueId(v)) return exchange(c, "");
  c.venue = v;
  await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, venue: v, user_id: c.userId, first_name: c.firstName ?? null, updated_at: new Date().toISOString() });
  if (c.userId) { const { data: p } = await c.sb.from("profiles").select("preferences").eq("id", c.userId).maybeSingle(); await c.sb.from("profiles").update({ preferences: { ...(p?.preferences ?? {}), venue: v } }).eq("id", c.userId); }
  return tgSend(c.chatId, `${who(c)}Exchange set to <b>${esc(VENUE_META[v].label)}</b>${VENUE_META[v].canShort ? "" : " (spot only: SHORT setups are shown as sell/reduce signals)"}.${c.userId ? " Synced to your account." : ""}`, { html: true, keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }, { text: "Menu", callback_data: "menu" }]] });
}

async function today(c: ChatCtx) {
  await tgTyping(c.chatId);
  const [condR, regR, fngR] = await Promise.all([safe(globalConditions()), safe(marketRegime()), safe(getFearGreed(2))]);
  const cond = condR.ok ? summarize(condR.data.conditions) : null;
  const r = regR.ok ? regR.data : null;
  const f = fngR.ok ? fngR.data[0] : null;
  const lines = [
    `<b>Today</b>`,
    cond ? `${cond.verdict === "avoid" ? "🔴" : cond.verdict === "caution" ? "🟡" : "🟢"} <b>Conditions:</b> ${esc(cond.headline)}` : "Conditions unavailable.",
    r ? `${r.label === "risk-on" ? "🟢" : r.label === "risk-off" ? "🔴" : "🟡"} <b>Regime:</b> ${esc(r.label)}. ${esc(r.headline)}\n${esc(r.advice)}\nBTC ${esc(r.btc.trend)} (score ${r.btc.score > 0 ? "+" : ""}${r.btc.score}), breadth ${r.breadth.above50}% up 30d, alt gauge ${r.alts.altSeason}% (${esc(r.alts.label)})${r.alts.btcDominance != null ? `, BTC dom ${r.alts.btcDominance}%` : ""}` : "Regime unavailable.",
    f ? `😨 <b>Fear & Greed:</b> ${f.value} (${esc(f.label)})` : "",
    condR.ok && condR.data.events?.length ? `\n<b>Next high-impact events:</b>\n${condR.data.events.slice(0, 3).map((e: any) => `- ${esc(e.title)} (${esc(new Date(e.time ?? e.date).toUTCString().slice(0, 22))})`).join("\n")}` : "",
  ].filter(Boolean);
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }, { text: "Watching", callback_data: "cat:watching" }], [{ text: "Open dashboard", url: link("/") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function loadCategory(c: ChatCtx, cat: "confirmed" | "watching" | "speculative" | "spot"): Promise<Opportunity[]> {
  // Same loader as the website's /api/opportunities (worker rows, live fallback, live re-verification), then the
  // same "can I place this on my exchange" filter the website applies. The two can no longer disagree.
  const r = await loadDiscovery(c.sb, { cat, venue: c.venue, verifyBudgetMs: 15_000 });
  const items = tradeableOn(r.items.filter((i) => i.category === cat), c.venue);
  return items.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

async function category(c: ChatCtx, cat: "confirmed" | "watching" | "speculative" | "spot", page = 0) {
  await tgTyping(c.chatId);
  const items = await loadCategory(c, cat);
  const vm = VENUE_META[c.venue];
  const title = { confirmed: "✅ Confirmed trades", watching: "👀 Watching", speculative: "⚠️ Speculative opportunities", spot: "🏦 Spot investments" }[cat];
  const per = 6;
  const slice = items.slice(page * per, page * per + per);
  const head = `${who(c)}<b>${title}</b> on ${esc(vm.label)}${cat === "confirmed" && !vm.canShort ? " (longs only)" : ""}: ${items.length}${cat === "confirmed" ? "\nConfirmed means the engine's gates passed; it is not a guarantee." : cat === "speculative" ? "\nHigh risk by definition. Position size: money you can lose entirely." : cat === "spot" ? "\nBuy and hold, no leverage. Zones are where accumulation makes sense." : "\nStructure is building; each one lists what must happen to confirm."}`;
  if (!slice.length) return tgSend(c.chatId, `${head}\n\n${cat === "confirmed" ? "Nothing qualifies right now. That is normal in quiet or risk-off markets; check Watching." : "Nothing here right now."}`, { html: true, keyboard: [[{ text: "Watching", callback_data: "cat:watching" }, { text: "Menu", callback_data: "menu" }]] });
  const lines = slice.map((i, idx) => {
    const n = page * per + idx + 1;
    const s = (i.detail as any)?.setup;
    if (cat === "spot") { const sp = i.spot!; const z = sp.analysis.accumulation; const inZone = i.price != null && i.price >= z.low && i.price <= z.high; return `${n}. <b>${esc(i.symbol)}</b> ${esc(sp.tier)} · score ${sp.score} · ${fmtUsd(i.price)}\n   zone ${fmtUsd(z.low)} to ${fmtUsd(z.high)}${inZone ? " · <b>in zone</b>" : ""}`; }
    if (cat === "speculative") { const sp = i.spec!; return `${n}. <b>${esc(i.symbol)}</b> ${esc(i.chain ?? "")} · ${fmtUsd(i.price)} · liq ${fmtUsd(i.liquidity, { compact: true })} · risk ${esc(i.risk)}\n   ${esc(sp.attention[0] ?? "")}`; }
    if (s) return `${n}. <b>${esc(i.symbol)}</b> ${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(i.timeframe)} · conf ${s.confidence}% · ${s.rr}R\n   entry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)} · SL ${fmtUsd(s.stopLosses[0]?.price)} · TP1 ${fmtUsd(s.takeProfits[0]?.price)}${cat === "watching" && (i.detail as any)?.watch?.[0] ? `\n   watching: ${esc((i.detail as any).watch[0].what)}` : ""}`;
    return `${n}. <b>${esc(i.symbol)}</b> ${esc(i.timeframe ?? "")}`;
  });
  const kb: Keyboard = [];
  for (let k = 0; k < slice.length; k += 3) kb.push(slice.slice(k, k + 3).map((i, j) => ({ text: `${page * per + k + j + 1}. ${i.symbol}`, callback_data: cat === "speculative" ? `menu` : `setup:${i.assetKey.replace(/^cg:/, "")}:${i.timeframe ?? "4h"}` })));
  const nav: Keyboard[number] = [];
  if (page > 0) nav.push({ text: "◀ Prev", callback_data: `cat:${cat}:${page - 1}` });
  if (items.length > (page + 1) * per) nav.push({ text: "Next ▶", callback_data: `cat:${cat}:${page + 1}` });
  nav.push({ text: "Menu", callback_data: "menu" });
  kb.push(nav);
  kb.push([{ text: "Open on the website", url: link(`/opportunities?cat=${cat}`) ?? "https://t.me" }]);
  return tgSend(c.chatId, `${head}\n\n${lines.join("\n\n")}${cat !== "speculative" ? "\n\nTap a coin for the full card." : ""}`, { html: true, keyboard: kb });
}

/**
 * Resolves what a user or a button gave us: a ticker ("SOL", "$sol"), a CoinGecko id ("solana", "binancecoin")
 * or a short button ref ("~SOL" = symbol, used when the id is too long for Telegram's 64-byte callback data).
 */
async function resolveCoin(q: string): Promise<{ id: string; symbol: string; name: string } | null> {
  let t = q.trim();
  if (!t) return null;
  const bySymbol = t.startsWith("~") || t.startsWith("$");
  t = t.replace(/^[~$]/, "");
  if (!bySymbol && /^[a-z0-9][a-z0-9-]{1,80}$/.test(t) && (t.includes("-") || t.length > 6 || t === t.toLowerCase())) {
    // Looks like an id: ask for it directly first (search does not find every id, e.g. "binancecoin").
    const m = await safe(getMarketsByIds([t]));
    if (m.ok && m.data[0]) { const x: any = m.data[0]; return { id: x.id, symbol: String(x.symbol).toUpperCase(), name: x.name }; }
  }
  const r = await safe(cgSearch(t));
  if (!r.ok || !r.data.length) return null;
  const up = t.toUpperCase();
  const hit = r.data.find((x) => x.symbol.toUpperCase() === up) ?? r.data.find((x) => x.id === t.toLowerCase() || x.name.toUpperCase() === up) ?? r.data[0];
  return { id: hit.id, symbol: hit.symbol.toUpperCase(), name: hit.name };
}
/** Button-safe reference: the id when short enough, else "~SYMBOL". Telegram rejects callback_data over 64 bytes. */
const ref = (cn: { id: string; symbol: string }) => (cn.id.length <= 36 ? cn.id : `~${cn.symbol}`);
const refKey = (assetKey: string, symbol: string) => ref({ id: assetKey.replace(/^cg:/, ""), symbol });

async function coin(c: ChatCtx, arg: string, tfArg?: Timeframe) {
  const parts = arg.trim().split(/\s+/);
  const tf = (tfArg ?? (["1h", "4h", "1d", "15m", "1w"].includes(parts[1]) ? parts[1] : undefined)) as Timeframe | undefined;
  const coinQ = parts[0];
  if (!coinQ) return tgSend(c.chatId, "Which coin? Example: /coin SOL or /coin SOL 1h, or a contract address.");
  if (classifyAddress(coinQ) !== "unknown") return scanCard(c, coinQ);
  await tgTyping(c.chatId);
  const cn = await resolveCoin(coinQ);
  if (!cn) return tgSend(c.chatId, `I could not find "${esc(coinQ)}".`, { html: true });
  return setupCard(c, cn.id, tf ?? "4h", cn);
}

async function setupCard(c: ChatCtx, id: string, tf: Timeframe, known?: { id: string; symbol: string; name: string }) {
  await tgTyping(c.chatId);
  const cn = known ?? (await resolveCoin(id));
  if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, ["1h", "4h", "1d"]));
  if (!a.ok) return tgSend(c.chatId, `Could not load ${esc(cn.symbol)}: ${esc(a.error)}`, { html: true });
  const t = a.data.timeframes[tf];
  const listings = await venueListings();
  const vs = venuesFor(cn.symbol, listings, c.venue);
  const where = vs.includes(c.venue) ? `Listed on ${VENUE_META[c.venue].label}` : vs.length ? `Not on ${VENUE_META[c.venue].label}; on ${vs.map((v) => VENUE_META[v].label).join(", ")}` : "DEX only";
  const tfRow: Keyboard[number] = (["1h", "4h", "1d"] as Timeframe[]).map((x) => ({ text: (x === tf ? "• " : "") + x, callback_data: `coin:${ref(cn)}:${x}` }));
  if (!t || "unavailable" in t) return tgSend(c.chatId, `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> ${tf}: no data. ${esc(a.data.consensus.summary)}`, { html: true, keyboard: [tfRow, [{ text: "Menu", callback_data: "menu" }]] });
  const s = t.setup;
  const head = `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> · ${fmtUsd(t.price)} · ${tf}\n${t.outlook === "strongly bullish" || t.outlook === "bullish" ? "🟢" : t.outlook.includes("bear") ? "🔴" : "🟡"} ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}) · trend ${esc(t.trend.direction)} · RSI ${t.momentum.rsi.toFixed(0)} · vol ${t.volume.ratio.toFixed(2)}x\n${esc(a.data.consensus.summary)}\n${esc(where)}`;
  const levels = t.levels.slice(0, 4).map((l) => `${l.kind === "support" ? "S" : "R"} ${fmtUsd(l.price)}`).join(" · ");
  const pats = [...t.patterns.confirmed.map((p) => `${p.name} ✓`), ...t.patterns.forming.map((p) => `${p.name} (forming)`)].slice(0, 3).join(", ");
  let body = `\n<b>Levels:</b> ${esc(levels || "none")}${pats ? `\n<b>Patterns:</b> ${esc(pats)}` : ""}`;
  const kb: Keyboard = [tfRow];
  if (s) {
    const tag = s.kind === "confirmed" ? "✅ CONFIRMED" : s.kind === "speculative" ? "⚠️ speculative" : "👀 watch";
    body += `\n\n<b>${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} setup · ${tag}</b> · conf ${s.confidence}% · ${s.riskRewardTp2}R · ${esc(s.style)}\nEntry: ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}\n${s.takeProfits.slice(0, 3).map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`).join("\n")}\n${s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`).join(" · ")}\nLeverage: ${s.leverage.recommended}x recommended (max ${s.leverage.maxSafe}x)`;
    if (s.kind !== "confirmed" && s.quality.confirmGaps.length) body += `\n<b>Missing for Confirmed:</b> ${esc(s.quality.confirmGaps[0])}`;
    if (s.kind === "watch" && s.quality.issues.length) body += `\n<b>Why only watch:</b> ${esc(s.quality.issues[0])}`;
    if (s.invalidation?.length) body += `\n<b>Invalidated if:</b> ${esc(s.invalidation[0])}`;
    const z = zoneStatus(t.price, s.entry, s.side);
    if (z.state !== "unknown") body += `\n<b>${z.state === "in" ? "🟢" : z.tone === "down" ? "🔴" : "🟡"} Now:</b> ${esc(z.label)}. ${esc(z.advice)}`;
    if (s.side === "SHORT" && !VENUE_META[c.venue].canShort) body += `\n\n${esc(VENUE_META[c.venue].label)} is spot only: treat this SHORT as a sell/reduce signal if you hold ${esc(cn.symbol)}.`;
    kb.push([{ text: "📋 Copy setup", callback_data: `copy:${ref(cn)}:${tf}` }, { text: "📐 Size it", callback_data: `size:${s.entry.mid}:${s.stopLosses[0].price}` }]);
    kb.push([{ text: "✍️ I took it", callback_data: `take:${ref(cn)}:${tf}:real` }, { text: "🧪 Paper trade", callback_data: `take:${ref(cn)}:${tf}:paper` }]);
    kb.push([{ text: "🔔 Alert at TP1/SL", callback_data: `alerttp:${ref(cn)}:${tf}` }, { text: "🔔 Entering zone", callback_data: `zonealert:${ref(cn)}:${tf}` }]);
    kb.push([...(s.kind !== "confirmed" ? [{ text: "🔔 When it confirms", callback_data: `confirmalert:${ref(cn)}` }] : []), { text: "⭐ Watch", callback_data: `watch:${ref(cn)}` }]);
    const guide = link(`/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: cn.symbol, leverage: String(s.leverage.recommended), venue: c.venue })}`);
    kb.push([{ text: "📖 How to place it", url: guide ?? "https://t.me" }, { text: "📈 Chart", url: link(`/token/${cn.id}?tf=${tf}`) ?? "https://t.me" }]);
    // share-card image when the site URL is known
    const og = link(`/api/og?${new URLSearchParams({ symbol: cn.symbol, tf, side: s.side, kind: s.kind, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), sl1: String(s.stopLosses[0].price), sl2: String(s.stopLosses[1]?.price ?? s.stopLosses[0].price), rr: String(s.riskRewardTp2), lev: String(s.leverage.recommended), conf: String(s.confidence), style: s.style, theme: "foundry" })}`);
    // Share card first (short caption: Telegram caps captions at 1024 chars), then the full card with buttons.
    if (og) await tgPhoto(c.chatId, og, `<b>${esc(cn.symbol)} ${s.side} ${tf}</b> · ${esc(s.kind)} · conf ${s.confidence}% · ${s.riskRewardTp2}R`);
  } else {
    body += `\n\nNo tradeable setup on ${tf}.`;
    kb.push([{ text: "📈 Chart", url: link(`/token/${cn.id}?tf=${tf}`) ?? "https://t.me" }, { text: "🔔 When it confirms", callback_data: `confirmalert:${ref(cn)}` }, { text: "⭐ Watch", callback_data: `watch:${ref(cn)}` }]);
  }
  kb.push([{ text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, head + body, { html: true, keyboard: kb });
}

async function copySetup(c: ChatCtx, id: string, tf: Timeframe) {
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  if (!s) return tgSend(c.chatId, "No setup to copy right now.");
  const vm = VENUE_META[c.venue];
  const txt = [`${cn.symbol} ${s.side} ${tf} - ${s.kind} - AsheSignal`, `Pair on ${vm.label}: ${vm.instrument(cn.symbol, vm.quotes[0])}`, `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`, ...s.takeProfits.map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`), ...s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`), `Leverage: ${s.leverage.recommended}x (max ${s.leverage.maxSafe}x)`, `Sizing: risk 1% of account between entry and SL1`, `Manual trading only. Not financial advice.`].join("\n");
  return tgSend(c.chatId, `<pre>${esc(txt)}</pre>\nLong-press to copy.`, { html: true });
}

async function screener(c: ChatCtx, mode: string) {
  await tgTyping(c.chatId);
  const { data } = await c.sb.from("coin_metrics").select("symbol, name, asset_key, price, score, outlook, rsi, vol_ratio, opportunity, setup_kind, setup_side, change_24h_pct").eq("timeframe", "4h").limit(400);
  let rows = (data ?? []) as any[];
  if (!rows.length) return tgSend(c.chatId, "The screener fills within an hour of the worker's first run.");
  const title = { score: "Top by opportunity score", rsi: "Highest RSI", oversold: "Most oversold (RSI)", overbought: "Most overbought (RSI)", volume: "Highest volume vs average" }[mode] ?? "Top by opportunity score";
  rows = mode === "oversold" ? rows.sort((a, b) => a.rsi - b.rsi) : mode === "overbought" || mode === "rsi" ? rows.sort((a, b) => b.rsi - a.rsi) : mode === "volume" ? rows.sort((a, b) => b.vol_ratio - a.vol_ratio) : rows.sort((a, b) => (b.opportunity ?? 0) - (a.opportunity ?? 0));
  const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. <b>${esc(r.symbol)}</b> ${fmtUsd(r.price)} · ${esc(r.outlook)} ${r.score > 0 ? "+" : ""}${r.score} · RSI ${Number(r.rsi).toFixed(0)} · vol ${Number(r.vol_ratio).toFixed(1)}x${r.setup_kind && r.setup_kind !== "watch" ? ` · ${esc(r.setup_side)} ${esc(r.setup_kind)}` : ""}`);
  return tgSend(c.chatId, `<b>📊 Screener (4h): ${esc(title)}</b>\n\n${lines.join("\n")}`, { html: true, keyboard: [[{ text: "Score", callback_data: "screener:score" }, { text: "Oversold", callback_data: "screener:oversold" }, { text: "Overbought", callback_data: "screener:overbought" }, { text: "Volume", callback_data: "screener:volume" }], ...rows.slice(0, 6).reduce<Keyboard>((acc, r, i) => { if (i % 3 === 0) acc.push([]); acc[acc.length - 1].push({ text: r.symbol, callback_data: `setup:${refKey(String(r.asset_key), r.symbol)}:4h` }); return acc; }, []), [{ text: "Full screener", url: link("/screener") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function size(c: ChatCtx, arg: string) {
  const nums = arg.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 2) return tgSend(c.chatId, "Usage: /size ENTRY STOP [balance] [risk%]\nExample: /size 0.594 0.583 500 1");
  let [entry, stop, balance, riskPct] = nums;
  if (!balance && c.userId) { const { data: p } = await c.sb.from("profiles").select("trading_balance, risk_pct").eq("id", c.userId).maybeSingle(); balance = Number(p?.trading_balance) || 0; riskPct = riskPct || Number(p?.risk_pct) || 1; }
  if (!balance) return tgSend(c.chatId, "I need a balance: /size ENTRY STOP BALANCE [risk%], or link your account and set it on the Risk page.");
  riskPct = riskPct || 1;
  const side = stop < entry ? "LONG" : "SHORT";
  const r = sizePosition({ tradingBalance: balance, riskPct, side, entry, stop, takeProfits: [], leverage: 1, maxExposurePct: 25 });
  if (!r.ok) return tgSend(c.chatId, `Cannot size: ${esc(r.warnings[0] ?? "check the numbers")}`, { html: true });
  return tgSend(c.chatId, `<b>📐 Position size</b> (${side}, spot)\nBuy/sell <b>${fmtNum(r.positionSizeUnits, 4)} units</b> (about ${fmtUsd(r.positionValueUsd)}).\nIf the stop at ${fmtUsd(stop)} hits you lose <b>${fmtUsd(r.riskUsd)}</b> (${riskPct}% of ${fmtUsd(balance)}${r.capped && r.capped !== "risk" ? `, capped by ${esc(r.capped)}` : ""}).\nStop is ${r.stopDistancePct}% from entry.${r.warnings.length ? `\n${esc(r.warnings[0])}` : ""}`, { html: true, keyboard: [[{ text: "Full calculator", url: link(`/risk?side=${side}&entry=${entry}&stop=${stop}`) ?? "https://t.me" }]] });
}

// ---------- account-bound ----------

function needLink(c: ChatCtx) { return tgSend(c.chatId, "This needs your account: open the website, Account page, Telegram section, and send me the /link CODE shown there.", { keyboard: [[{ text: "Open Account page", url: link("/account") ?? "https://t.me" }]] }); }

async function me(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const [{ data: open }, { data: prof }, { data: closed }] = await Promise.all([
    c.sb.from("saved_setups").select("id, symbol, side, timeframe, status, risk_usd, max_favorable_pct, max_adverse_pct, kind, paper, fill_price").eq("user_id", c.userId).eq("taken", true).is("exit_price", null),
    c.sb.from("profiles").select("trading_balance, risk_pct, preferences").eq("id", c.userId).maybeSingle(),
    c.sb.from("saved_setups").select("realized_r, realized_usd").eq("user_id", c.userId).eq("taken", true).eq("paper", false).not("exit_price", "is", null).order("exit_at", { ascending: false }).limit(30),
  ]);
  const real = (open ?? []).filter((t) => !t.paper);
  const heat = portfolioHeat(real.map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd) })), prof?.trading_balance ? Number(prof.trading_balance) : null, { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) });
  const wins = (closed ?? []).filter((x) => Number(x.realized_r) > 0).length;
  const pnl = (closed ?? []).reduce((s, x) => s + Number(x.realized_usd ?? 0), 0);
  const lines = [
    `<b>👤 My trades</b>`,
    `${heat.level === "stop" ? "🔴" : heat.level === "caution" ? "🟡" : "🟢"} Heat: ${heat.heatPct != null ? `${heat.heatPct}% of account at risk` : "set your balance on the Risk page"} · ${real.length} open${(open ?? []).length - real.length ? ` (+${(open ?? []).length - real.length} paper)` : ""}`,
    esc(heat.messages[0] ?? ""),
    ...real.map((t) => `- <b>${esc(t.symbol)}</b> ${t.side} ${esc(t.timeframe)}: ${esc(t.status)}${t.max_favorable_pct != null ? `, best +${t.max_favorable_pct}% / worst -${t.max_adverse_pct}%` : ""}${t.risk_usd ? `, ${fmtUsd(Number(t.risk_usd))} at risk` : ""}`),
    closed?.length ? `\nLast ${closed.length} closed: ${Math.round((100 * wins) / closed.length)}% winners, ${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}` : "\nNo closed trades yet.",
  ];
  const perTrade: Keyboard = (open ?? []).slice(0, 6).map((t) => [{ text: `🏁 Close ${t.symbol}`, callback_data: `closeq:${t.id}` }, { text: `✖ Cancel ${t.symbol}`, callback_data: `untake:${t.id}` }]);
  if (open?.length) lines.push("\n<i>Close = you exited on the exchange (I ask the exit price). Cancel = the order never filled or you changed your mind; it goes back to Saved and does not count.</i>");
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [...perTrade, [{ text: "Journal", url: link("/setups") ?? "https://t.me" }, { text: "Weekly review", url: link("/review") ?? "https://t.me" }], [{ text: "Menu", callback_data: "menu" }]] });
}

async function journal(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  const { data } = await c.sb.from("saved_setups").select("symbol, side, timeframe, status, taken_at, fill_price, size_usd, realized_usd, realized_r, exit_reason, paper").eq("user_id", c.userId).eq("taken", true).order("taken_at", { ascending: false }).limit(10);
  if (!data?.length) return tgSend(c.chatId, "No trades recorded yet. Use /take SOL after placing a trade, or the ✍️ button on a setup card.");
  const lines = data.map((t) => `${t.paper ? "🧪" : t.realized_r == null ? "⏳" : Number(t.realized_r) > 0 ? "✅" : "❌"} <b>${esc(t.symbol)}</b> ${t.side} ${esc(t.timeframe)} · ${esc(t.status)}${t.fill_price ? ` · fill ${fmtUsd(Number(t.fill_price))}` : ""}${t.size_usd ? ` · ${fmtUsd(Number(t.size_usd))}` : ""}${t.realized_r != null ? ` · <b>${Number(t.realized_r) > 0 ? "+" : ""}${t.realized_r}R</b> (${Number(t.realized_usd) >= 0 ? "+" : ""}${fmtUsd(Number(t.realized_usd))})` : ""}`);
  return tgSend(c.chatId, `<b>📒 Journal (last ${data.length})</b>\n${lines.join("\n")}`, { html: true, keyboard: [[{ text: "Open journal", url: link("/setups") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function alertsList(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  const [{ data: rules }, { data: events }] = await Promise.all([
    c.sb.from("alerts").select("symbol, type, params, timeframe, active").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(10),
    c.sb.from("alert_events").select("title, fired_at, read").eq("user_id", c.userId).order("fired_at", { ascending: false }).limit(5),
  ]);
  const r = (rules ?? []).map((a) => `${a.active ? "🔔" : "🔕"} ${esc(a.symbol)} ${esc(a.type)}${a.params?.price ? ` ${fmtUsd(Number(a.params.price))}` : ""}${a.params?.rsi ? ` ${a.params.rsi}` : ""} ${esc(a.timeframe ?? "")}`);
  const e = (events ?? []).map((x) => `${x.read ? "·" : "•"} ${esc(x.title)}`);
  return tgSend(c.chatId, `<b>🔔 Alerts</b>\n${r.length ? r.join("\n") : "No rules yet. Try: /alert BTC above 100000"}\n\n<b>Inbox</b>\n${e.length ? e.join("\n") : "Nothing fired yet."}`, { html: true, keyboard: [[{ text: "Manage alerts", url: link("/alerts") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function createAlert(c: ChatCtx, row: Record<string, unknown>) {
  const { error } = await c.sb.from("alerts").insert({ user_id: c.userId, channels: ["push", "email", "telegram"], cooldown_minutes: 60, timeframe: "1h", params: {}, ...row });
  return !error;
}

async function alertCreate(c: ChatCtx, arg: string) {
  if (!c.userId) return needLink(c);
  const m = arg.match(/^(\S+)\s+(above|below|over|under|>|<)\s+([\d.,]+)/i);
  if (!m) return tgSend(c.chatId, "Usage: /alert BTC above 100000  or  /alert SOL below 150");
  const cn = await resolveCoin(m[1]); if (!cn) return tgSend(c.chatId, `Coin "${esc(m[1])}" not found.`, { html: true });
  const price = Number(m[3].replace(/,/g, ""));
  const above = /above|over|>/i.test(m[2]);
  const ok = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: above ? "price_above" : "price_below", params: { price }, asset_ref: { symbol: cn.symbol, id: cn.id } });
  return tgSend(c.chatId, ok ? `🔔 Alert set: ${esc(cn.symbol)} ${above ? "above" : "below"} ${fmtUsd(price)}. You will hear from me here when it triggers.` : "Could not save the alert.", { html: true });
}
async function alertFromSetup(c: ChatCtx, id: string, tf: Timeframe) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  if (!s) return tgSend(c.chatId, "No setup to alert on.");
  const okTp = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_above" : "price_below", params: { price: s.takeProfits[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  const okSl = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_below" : "price_above", params: { price: s.stopLosses[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  return tgSend(c.chatId, okTp && okSl ? `🔔 Two alerts set for ${esc(cn.symbol)}: TP1 ${fmtUsd(s.takeProfits[0].price)} and SL1 ${fmtUsd(s.stopLosses[0].price)}.` : "Could not save the alerts.", { html: true });
}
async function alertZone(c: ChatCtx, id: string, tf: Timeframe) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  if (!s) return tgSend(c.chatId, "No entry zone to watch.");
  const ok = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: "entry_zone", params: { low: s.entry.low, high: s.entry.high, side: s.side }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf, channels: ["push", "email", "telegram"] });
  return tgSend(c.chatId, ok ? `🔔 I will tell you when ${esc(cn.symbol)} comes into the entry zone ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}.` : "Could not save the alert.", { html: true });
}
async function alertConfirm(c: ChatCtx, id: string) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const ok = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: "new_confirmed", params: {}, asset_ref: { symbol: cn.symbol, id: cn.id } });
  return tgSend(c.chatId, ok ? `🔔 I will tell you when ${esc(cn.symbol)} enters Confirmed Trades on any timeframe.` : "Could not save the alert.", { html: true });
}

// ---------- guided trade recording ----------

async function takeStart(c: ChatCtx, arg: string, tf: Timeframe = "4h", paper = false) {
  if (!c.userId) return needLink(c);
  const q = arg.trim().split(/\s+/)[0];
  if (!q) return tgSend(c.chatId, "Which coin? /take SOL (or tap ✍️ on a setup card).");
  const cn = await resolveCoin(q); if (!cn) return tgSend(c.chatId, `Coin "${esc(q)}" not found.`, { html: true });
  if (c.isGroup) {
    // Plain-number answers in a group would be noise (and are hidden from the bot by privacy mode): continue privately.
    const me = await botUsername();
    const deep = me ? `https://t.me/${me}?start=take_${encodeURIComponent(ref(cn))}_${tf}_${paper ? "paper" : "real"}` : null;
    return tgSend(c.chatId, `${who(c)}Let's record ${esc(cn.symbol)} in private so the group stays clean.`, { html: true, keyboard: deep ? [[{ text: "✍️ Continue in private chat", url: deep }]] : undefined });
  }
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  const state = { flow: "take", step: "fill", coin: cn, tf, paper, setup: s ? { side: s.side, kind: s.kind, entry: s.entry, takeProfits: s.takeProfits.map((x) => ({ price: x.price })), stopLosses: s.stopLosses.map((x) => ({ price: x.price })), rr: s.riskRewardTp2, confidence: s.confidence, leverage: s.leverage } : null, price: t && !("unavailable" in t) ? t.price : null };
  await setState(c, state);
  return tgSend(c.chatId, `${paper ? "🧪 <b>Paper trade</b>" : "✍️ <b>Record trade</b>"}: ${esc(cn.symbol)} ${s ? `${s.side} ${tf} (${esc(s.kind)}, SL ${fmtUsd(s.stopLosses[0].price)}, TP1 ${fmtUsd(s.takeProfits[0].price)})` : tf}\n\nStep 1 of 3: what was your <b>fill price</b>?${state.price ? ` (current ${fmtUsd(state.price)}; send "." to use it)` : ""}\nSend /cancel to stop.`, { html: true });
}

async function takeStep(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state;
  const num = (v: string) => { const n = Number(String(v).replace(",", ".").replace(/[$,]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
  if (st.step === "fill") {
    const fill = text.trim() === "." ? st.price : num(text);
    if (!fill) { await tgSend(c.chatId, "Send the fill price as a number (or . for the current price)."); return true; }
    st.fill = fill;
    if (!st.setup) { st.step = "stop"; await setState(c, st); await tgSend(c.chatId, `Step 2 of 3: your <b>stop loss</b> price? (no engine setup for this coin, so I need yours)`, { html: true }); return true; }
    if (VENUE_META[c.venue].canShort) { st.step = "lev"; await setState(c, st); await tgSend(c.chatId, `Step 2 of 4: <b>leverage</b> used? (engine suggests ${st.setup.leverage?.recommended ?? 1}x, max ${st.setup.leverage?.maxSafe ?? 3}x; send 1 for spot)`, { html: true }); return true; }
    st.lev = 1; st.step = "size"; await setState(c, st); await tgSend(c.chatId, `Step 2 of 3: <b>size in USD</b>? (e.g. 50)${st.paper ? " Pretend size is fine." : ""}`, { html: true }); return true;
  }
  if (st.step === "lev") {
    const lv = num(text); if (!lv || lv > 125) { await tgSend(c.chatId, "Send the leverage as a number between 1 and 125."); return true; }
    st.lev = lv; st.step = "size"; await setState(c, st);
    await tgSend(c.chatId, `Step 3 of 4: ${lv > 1 ? "<b>margin in USD</b> (the money you put in; position = margin x " + lv + ")" : "<b>size in USD</b>"}?`, { html: true }); return true;
  }
  if (st.step === "stop") {
    const stop = num(text); if (!stop) { await tgSend(c.chatId, "Send the stop price as a number."); return true; }
    st.setup = { side: stop < st.fill ? "LONG" : "SHORT", kind: "speculative", entry: { low: st.fill, high: st.fill, mid: st.fill }, takeProfits: [], stopLosses: [{ price: stop }], rr: 0, confidence: 0, leverage: null };
    st.lev = 1; st.step = "size"; await setState(c, st); await tgSend(c.chatId, `Step 3 of 3: <b>size in USD</b>?`, { html: true }); return true;
  }
  if (st.step === "size") {
    const usd = num(text); if (!usd) { await tgSend(c.chatId, "Send the size in USD as a number."); return true; }
    const lev = Number(st.lev) || 1;
    st.margin = usd; st.usd = usd * lev; st.step = "confirm"; await setState(c, st);
    await tgTyping(c.chatId);
    const units = (usd * lev) / st.fill;
    const liq = lev > 1 ? (st.setup.side === "LONG" ? st.fill * (1 - 0.95 / lev) : st.fill * (1 + 0.95 / lev)) : null;
    const slp = st.setup.stopLosses[0]?.price ?? null;
    const liqBeforeStop = liq != null && slp != null && (st.setup.side === "LONG" ? liq >= slp : liq <= slp);
    const sl = st.setup.stopLosses[0]?.price ?? null;
    const riskUsd = sl ? Math.abs(st.fill - sl) * units : null;
    const account = c.userId ? await accountForChecks(c.sb, c.userId) : null;
    const pre = await safe(preTradeChecks({ symbol: st.coin.symbol, side: st.setup.side, kind: st.setup.kind, price: st.price ?? st.fill, entry: st.setup.entry, stop: sl, venue: c.venue, riskUsd, account }));
    const icon = (l: string) => (l === "ok" ? "✅" : l === "warn" ? "⚠️" : l === "fail" ? "⛔" : "▫️");
    const checks = pre.ok ? pre.data.checks.map((k) => `${icon(k.level)} <b>${esc(k.label)}.</b> ${esc(k.detail)}`).join("\n") : "Checklist unavailable right now.";
    const verdict = pre.ok ? (pre.data.verdict === "go" ? "🟢 GO" : pre.data.verdict === "careful" ? "🟡 CAREFUL" : "🔴 WAIT") : "";
    await tgSend(c.chatId, `<b>Pre-trade check ${verdict}</b>\n${checks}\n\n${esc(st.coin.symbol)} ${st.setup.side}: fill ${fmtUsd(st.fill)}, ${lev > 1 ? `${lev}x, margin ${fmtUsd(usd)}, position ${fmtUsd(usd * lev)}` : fmtUsd(usd)}, ${fmtNum(units, 4)} units${riskUsd != null ? `, <b>${fmtUsd(riskUsd)}</b> at risk if the stop hits (${Math.round((riskUsd / usd) * 100)}% of your ${lev > 1 ? "margin" : "stake"})` : ""}.${liq != null ? ` Est. liquidation near ${fmtUsd(liq)}${liqBeforeStop ? " which is BEFORE your stop: lower the leverage." : "."}` : ""}\n${st.paper ? "Record this paper trade?" : "Did you place it? Record it in the journal?"}`, { html: true, keyboard: [[{ text: st.paper ? "🧪 Record paper trade" : "✅ Yes, I placed it", callback_data: "takesave:yes" }, { text: "✖ Cancel", callback_data: "takesave:no" }]] });
    return true;
  }
  return false;
}

async function takeFinish(c: ChatCtx, yes: boolean) {
  const st = c.state;
  if (!st?.flow || st.step !== "confirm") return tgSend(c.chatId, "Nothing to record. Start with /take SOL or the ✍️ button.");
  if (!yes) { await setState(c, null); return tgSend(c.chatId, "Cancelled, nothing recorded."); }
  const usd = Number(st.usd);
  const lev = Number(st.lev) || 1;
  const units = usd / st.fill;
  const sl = st.setup.stopLosses[0]?.price;
  const riskUsd = sl ? Math.abs(st.fill - sl) * units : null;
  st.setup.leverage = { ...(st.setup.leverage ?? {}), recommended: lev, used: lev };
  const row = { user_id: c.userId, asset_key: `cg:${st.coin.id}`, symbol: st.coin.symbol, timeframe: st.tf, side: st.setup.side, kind: st.setup.kind, entry_low: st.setup.entry.low, entry_high: st.setup.entry.high, tp1: st.setup.takeProfits[0]?.price ?? null, tp2: st.setup.takeProfits[1]?.price ?? null, tp3: st.setup.takeProfits[2]?.price ?? null, sl1: sl ?? null, sl2: st.setup.stopLosses[1]?.price ?? null, rr: st.setup.rr ?? null, leverage: lev, confidence: st.setup.confidence ?? null, payload: st.setup, taken: true, paper: !!st.paper, taken_at: new Date().toISOString(), exchange: st.paper ? "paper" : c.venue, fill_price: st.fill, size_units: units, size_usd: usd, risk_usd: riskUsd, notes: lev > 1 ? `Recorded via Telegram · ${lev}x leverage, margin ${fmtUsd(Number(st.margin))}` : "Recorded via Telegram" };
  const { data: ins, error } = await c.sb.from("saved_setups").insert(row).select("id").single();
  await setState(c, null);
  if (error) return tgSend(c.chatId, `Could not save: ${esc(error.message)}`, { html: true });
  return tgSend(c.chatId, `${st.paper ? "🧪 Paper trade" : "✅ Trade"} recorded: ${esc(st.coin.symbol)} ${st.setup.side} ${esc(st.tf)}, fill ${fmtUsd(st.fill)}, ${fmtNum(units, 4)} units (${fmtUsd(usd)})${riskUsd != null ? `, ${fmtUsd(riskUsd)} at risk if the stop hits` : ""}.\nI will message you when it reaches a target or the stop. Pressed by mistake or the order never filled? Undo removes it.`, { html: true, keyboard: [[{ text: "↩ Undo", callback_data: `rm:${ins?.id ?? ""}` }, { text: "My trades", callback_data: "me" }], [{ text: "Journal", url: link("/setups") ?? "https://t.me" }]] });
}

/** Undo (delete) a trade recorded by mistake, or cancel it (never filled): back to Saved, out of the stats. */
async function removeTrade(c: ChatCtx, id: string, hardDelete: boolean) {
  if (!c.userId) return needLink(c);
  if (!id) return tgSend(c.chatId, "Nothing to remove.");
  const { data: row } = await c.sb.from("saved_setups").select("id, symbol, side, timeframe").eq("id", id).eq("user_id", c.userId).maybeSingle();
  if (!row) return tgSend(c.chatId, "That trade is no longer in your journal.");
  if (hardDelete) await c.sb.from("saved_setups").delete().eq("id", id).eq("user_id", c.userId);
  else await c.sb.from("saved_setups").update({ taken: false, taken_at: null, status: "open", resolved_at: null, fill_price: null, size_units: null, size_usd: null, risk_usd: null }).eq("id", id).eq("user_id", c.userId);
  return tgSend(c.chatId, `${who(c)}${hardDelete ? "↩ Removed" : "✖ Cancelled"}: ${esc(row.symbol)} ${row.side} ${esc(row.timeframe)}${hardDelete ? " is out of your journal." : " went back to Saved setups; it will not count in your stats."}`, { html: true, keyboard: [[{ text: "My trades", callback_data: "me" }, { text: "Menu", callback_data: "menu" }]] });
}
async function closeStart(c: ChatCtx, id: string) {
  if (!c.userId) return needLink(c);
  const { data: row } = await c.sb.from("saved_setups").select("id, symbol, side, timeframe, fill_price, size_units, sl1, paper").eq("id", id).eq("user_id", c.userId).is("exit_price", null).maybeSingle();
  if (!row) return tgSend(c.chatId, "That trade is already closed or gone.");
  if (c.isGroup) return tgSend(c.chatId, `${who(c)}Let's close ${esc(row.symbol)} in private chat: open @${esc((await botUsername()) ?? "AsheSignalBot")} and press 🏁 Close there.`, { html: true });
  await setState(c, { flow: "close", id: row.id, symbol: row.symbol, side: row.side, tf: row.timeframe });
  return tgSend(c.chatId, `🏁 Closing ${esc(row.symbol)} ${row.side} ${esc(row.timeframe)}. What was your <b>exit price</b>? (average if you exited in parts)\nSend /cancel to keep it open.`, { html: true });
}
async function closeStep(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state;
  const exit = Number(String(text).replace(",", ".").replace(/[$,]/g, ""));
  if (!Number.isFinite(exit) || exit <= 0) { await tgSend(c.chatId, "Send the exit price as a number, or /cancel."); return true; }
  const { data: row } = await c.sb.from("saved_setups").select("*").eq("id", st.id).eq("user_id", c.userId).maybeSingle();
  await setState(c, null);
  if (!row) { await tgSend(c.chatId, "That trade is gone."); return true; }
  const fill = Number(row.fill_price ?? (Number(row.entry_low) + Number(row.entry_high)) / 2);
  const units = Number(row.size_units ?? 0);
  const fees = Number(row.fees_usd ?? 0);
  const dir = row.side === "LONG" ? 1 : -1;
  const pnl = units > 0 ? (exit - fill) * dir * units - fees : null;
  const riskPerUnit = Math.abs(fill - Number(row.sl1 ?? fill));
  const riskUsd = Number(row.risk_usd ?? (units > 0 && riskPerUnit > 0 ? units * riskPerUnit : 0));
  const r = pnl != null && riskUsd > 0 ? Math.round((pnl / riskUsd) * 100) / 100 : riskPerUnit > 0 ? Math.round((((exit - fill) * dir) / riskPerUnit) * 100) / 100 : null;
  const now = new Date().toISOString();
  await c.sb.from("saved_setups").update({ exit_price: exit, exit_at: now, exit_reason: "manual", realized_usd: pnl, realized_r: r, ...(row.resolved_at ? {} : { status: "closed", resolved_at: now }) }).eq("id", row.id);
  await tgSend(c.chatId, `🏁 Closed ${esc(row.symbol)} ${row.side} at ${fmtUsd(exit)}${pnl != null ? `: <b>${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}</b>` : ""}${r != null ? ` (${r > 0 ? "+" : ""}${r}R)` : ""}. ${pnl != null && pnl >= 0 ? "Nice." : "Logged; losses that respect the stop are part of the plan."}`, { html: true, keyboard: [[{ text: "My trades", callback_data: "me" }, { text: "Weekly review", callback_data: "review" }]] });
  return true;
}

// ---------- watchlist ----------

async function watchlistId(c: ChatCtx): Promise<string | null> {
  const { data: wl } = await c.sb.from("watchlists").select("id").eq("user_id", c.userId).order("position").limit(1).maybeSingle();
  if (wl?.id) return wl.id;
  const { data: created } = await c.sb.from("watchlists").insert({ user_id: c.userId, name: "Favorites" }).select("id").single();
  return created?.id ?? null;
}
async function watchAdd(c: ChatCtx, arg: string) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(arg.split(/\s+/)[0] ?? ""); if (!cn) return tgSend(c.chatId, "Which coin? /watch SOL");
  const wid = await watchlistId(c); if (!wid) return tgSend(c.chatId, "Could not open your watchlist.");
  const { error } = await c.sb.from("watchlist_items").upsert({ watchlist_id: wid, user_id: c.userId, coingecko_id: cn.id, chain: null, address: null, symbol: cn.symbol, name: cn.name }, { onConflict: "watchlist_id,coingecko_id,chain,address", ignoreDuplicates: true });
  if (error) return tgSend(c.chatId, `Could not save: ${esc(error.message)}`, { html: true });
  return tgSend(c.chatId, `${who(c)}⭐ ${esc(cn.symbol)} added to your watchlist (synced with the website).`, { html: true, keyboard: [[{ text: "Watchlist", callback_data: "watchlist" }, { text: "🔔 When it confirms", callback_data: `confirmalert:${ref(cn)}` }]] });
}
async function watchRemove(c: ChatCtx, arg: string) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(arg.split(/\s+/)[0] ?? ""); if (!cn) return tgSend(c.chatId, "Which coin? /unwatch SOL");
  await c.sb.from("watchlist_items").delete().eq("user_id", c.userId).eq("coingecko_id", cn.id);
  return tgSend(c.chatId, `${who(c)}${esc(cn.symbol)} removed from your watchlist.`, { html: true, keyboard: [[{ text: "Watchlist", callback_data: "watchlist" }]] });
}
async function watchlist(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const { data } = await c.sb.from("watchlist_items").select("coingecko_id, symbol, name").eq("user_id", c.userId).not("coingecko_id", "is", null).order("created_at", { ascending: false }).limit(20);
  if (!data?.length) return tgSend(c.chatId, "Your watchlist is empty. Add with /watch SOL or ⭐ on any coin card.", { keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }]] });
  const ids = data.map((d) => d.coingecko_id as string);
  const [{ data: rows }, mk] = await Promise.all([
    c.sb.from("coin_metrics").select("asset_key, timeframe, category, price, detail, outlook, score").in("asset_key", ids.map((i) => `cg:${i}`)).in("timeframe", ["4h", "1d"]),
    safe(getMarketsByIds(ids)),
  ]);
  const price = new Map<string, { price: number; chg: number | null }>();
  if (mk.ok) for (const m of mk.data as any[]) price.set(m.id, { price: m.current_price ?? m.price, chg: m.price_change_percentage_24h ?? m.change24h ?? null });
  const lines = data.map((d) => {
    const mine = (rows ?? []).filter((r) => r.asset_key === `cg:${d.coingecko_id}`);
    const best = mine.find((r) => r.category === "confirmed") ?? mine.find((r) => r.category === "watching") ?? mine.find((r) => r.timeframe === "4h") ?? mine[0];
    const p = price.get(d.coingecko_id as string);
    const px = p?.price ?? best?.price ?? null;
    let line = `<b>${esc(d.symbol)}</b> ${px ? fmtUsd(px) : ""}${p?.chg != null ? ` (${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%)` : ""}`;
    if (best?.category === "confirmed" || best?.category === "watching") {
      const st = best.detail?.setup; const z = st ? zoneStatus(px, st.entry, st.side) : null;
      line += ` · ${best.category === "confirmed" ? "✅" : "👀"} ${esc(best.category)} ${st ? `${st.side} ` : ""}${esc(best.timeframe)}${z && z.state !== "unknown" ? ` · ${z.state === "in" ? "🟢 in zone" : esc(z.label)}` : ""}`;
    } else if (best) line += ` · ${esc(best.outlook ?? "")} ${best.score > 0 ? "+" : ""}${best.score ?? ""} · no setup`;
    else line += " · not screened yet";
    return line;
  });
  const kb: Keyboard = [];
  for (let k = 0; k < Math.min(data.length, 9); k += 3) kb.push(data.slice(k, k + 3).map((d) => ({ text: d.symbol, callback_data: `setup:${ref({ id: String(d.coingecko_id), symbol: d.symbol })}:4h` })));
  kb.push([{ text: "Open watchlist", url: link("/watchlist") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, `${who(c)}<b>⭐ Watchlist</b> (${data.length})\n${lines.join("\n")}\n\nTap a coin for its card. /unwatch SYM removes one.`, { html: true, keyboard: kb });
}

// ---------- top, review, digest, settings ----------

async function top(c: ChatCtx) {
  await tgTyping(c.chatId);
  const items = (await loadCategory(c, "confirmed")).slice(0, 3);
  const vm = VENUE_META[c.venue];
  if (!items.length) { const w = (await loadCategory(c, "watching")).slice(0, 3); return tgSend(c.chatId, `${who(c)}<b>🏆 Top for ${esc(vm.label)}</b>\nNo confirmed setup you can place right now${vm.canShort ? "" : " (longs only)"}. Closest to confirming:\n${w.map((i) => { const st = (i.detail as any)?.setup; const need = (i.detail as any)?.watch?.[0]?.needs; return `• <b>${esc(i.symbol)}</b> ${st?.side ?? ""} ${esc(i.timeframe ?? "")}${need ? `: needs ${esc(need)}` : ""}`; }).join("\n") || "nothing close."}`, { html: true, keyboard: [[{ text: "Watching", callback_data: "cat:watching" }, { text: "Menu", callback_data: "menu" }]] }); }
  const lines = items.map((i, n) => { const st = (i.detail as any)?.setup; const z = zoneStatus(i.price, st?.entry, st?.side); return `${["🥇", "🥈", "🥉"][n]} <b>${esc(i.symbol)}</b> ${st.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(i.timeframe)} · conf ${st.confidence}% · ${st.rr}R\n   entry ${fmtUsd(st.entry.low)} to ${fmtUsd(st.entry.high)} · SL ${fmtUsd(st.stopLosses[0]?.price)} · TP1 ${fmtUsd(st.takeProfits[0]?.price)}${z.state !== "unknown" ? `\n   ${z.state === "in" ? "🟢 price in zone" : `${z.tone === "down" ? "🔴" : "🟡"} ${esc(z.label)}`}` : ""}${(i.detail as any)?.qualifies?.[0] ? `\n   ${esc((i.detail as any).qualifies[0])}` : ""}`; });
  return tgSend(c.chatId, `${who(c)}<b>🏆 Top ${items.length} confirmed for ${esc(vm.label)}</b>\nRanked by confidence. Confirmed is a gate, not a promise: size by the stop.\n\n${lines.join("\n\n")}`, { html: true, keyboard: [items.map((i) => ({ text: i.symbol, callback_data: `setup:${refKey(i.assetKey, i.symbol)}:${i.timeframe ?? "4h"}` })), [{ text: "All confirmed", callback_data: "cat:confirmed" }, { text: "Menu", callback_data: "menu" }]] });
}

async function review(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const to = new Date(monday.getTime() + 7 * 86_400_000);
  const [{ data: journal }, { data: prof }, sig, hist] = await Promise.all([
    c.sb.from("saved_setups").select("*").eq("user_id", c.userId).eq("taken", true).gte("created_at", new Date(monday.getTime() - 60 * 86_400_000).toISOString()),
    c.sb.from("profiles").select("trading_balance, risk_pct").eq("id", c.userId).maybeSingle(),
    c.sb.from("signal_log").select("kind, outcome, emitted_at, side, timeframe").gte("emitted_at", monday.toISOString()).lt("emitted_at", to.toISOString()).limit(2000),
    c.sb.from("category_history").select("category, prev_category, changed_at").gte("changed_at", monday.toISOString()).lt("changed_at", to.toISOString()).limit(5000),
  ]);
  const r = buildWeeklyReview({ journal: (journal ?? []) as never, signals: (sig.data ?? []) as never, history: (hist.data ?? []) as never, tradingBalance: prof?.trading_balance ? Number(prof.trading_balance) : null, riskPct: prof?.risk_pct ? Number(prof.risk_pct) : null, from: monday, to });
  const j = r.journal;
  const body = [
    `${who(c)}<b>📅 Weekly review</b> (${monday.toISOString().slice(0, 10)} to today)`,
    `You: ${j.taken} taken, ${j.closed} closed, ${j.winRate != null ? `${j.winRate}% winners` : "no closed trades"}, ${j.pnlUsd >= 0 ? "+" : ""}${fmtUsd(j.pnlUsd)}${j.avgR != null ? `, avg ${j.avgR}R` : ""}${j.open ? `, ${j.open} open` : ""}`,
    j.bestR ? `Best ${esc(j.bestR.symbol)} ${j.bestR.r > 0 ? "+" : ""}${j.bestR.r}R${j.worstR ? ` · worst ${esc(j.worstR.symbol)} ${j.worstR.r}R` : ""}` : "",
    j.streak ? esc(j.streak) : "",
    `Engine: ${r.engine.confirmedNew} new confirmed, ${r.engine.confirmedLost} lost, ${r.engine.resolved}/${r.engine.signals} signals resolved${r.engine.winRate != null ? ` (${r.engine.winRate}% TP1)` : ""}`,
    j.flags.length ? `\n<b>Flags</b>\n${j.flags.slice(0, 4).map((f) => `⚠️ ${esc(f)}`).join("\n")}` : "",
    r.lessons.length ? `\n<b>Lessons</b>\n${r.lessons.slice(0, 3).map((l) => `• ${esc(l)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  return tgSend(c.chatId, body, { html: true, keyboard: [[{ text: "Full review", url: link("/review") ?? "https://t.me" }, { text: "Journal", callback_data: "me" }]] });
}

async function digestNow(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const { data: p } = await c.sb.from("profiles").select("preferences, digest_enabled, digest_hour").eq("id", c.userId).maybeSingle();
  const shared = await digestShared(c.sb);
  const d = await buildDigest(c.sb, c.userId, c.venue ?? p?.preferences?.venue, shared);
  return tgSend(c.chatId, `${who(c)}<b>☀️ ${esc(d.title)}</b>\n\n${esc(d.body)}${p?.digest_enabled ? "" : "\n\nThe automatic daily digest is off. Turn it on in /settings."}`, { html: true, keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }, { text: "Settings", callback_data: "settings" }]] });
}

async function settings(c: ChatCtx) {
  const vm = VENUE_META[c.venue];
  let digest = "";
  let kb: Keyboard = [[{ text: "⚙️ Change exchange", callback_data: "exchange" }]];
  if (c.userId) {
    const { data: p } = await c.sb.from("profiles").select("digest_enabled, digest_hour, email").eq("id", c.userId).maybeSingle();
    const h = Number(p?.digest_hour ?? 13);
    digest = `\nDaily digest: <b>${p?.digest_enabled ? `on, ${String(h).padStart(2, "0")}:00 UTC` : "off"}</b>\nAccount: ${esc(p?.email ?? "linked")}`;
    kb = [[{ text: p?.digest_enabled ? "🔕 Digest off" : "🔔 Digest on", callback_data: `settings:digest:${p?.digest_enabled ? "0" : "1"}` }, { text: "⏰ Hour -1", callback_data: `settings:hour:${(h + 23) % 24}` }, { text: "⏰ Hour +1", callback_data: `settings:hour:${(h + 1) % 24}` }], [{ text: "⚙️ Change exchange", callback_data: "exchange" }, { text: "🔓 Unlink", callback_data: "settings:unlink" }]];
  } else kb.push([{ text: "Open Account page to link", url: link("/account") ?? "https://t.me" }]);
  const { data: su } = await c.sb.from(c.isGroup ? "telegram_chats" : "telegram_users").select("broadcast").eq(c.isGroup ? "chat_id" : "tg_user_id", c.isGroup ? c.chatId : c.tgUserId).maybeSingle();
  const sigOn = su?.broadcast !== false;
  kb.unshift([{ text: sigOn ? "📣 Confirmed signals: ON (tap to mute)" : "📣 Confirmed signals: OFF (tap to enable)", callback_data: `signals:${sigOn ? "off" : "on"}` }]);
  kb.push([{ text: "Full settings on the website", url: link("/account") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, `${who(c)}<b>⚙️ Settings</b>\nExchange: <b>${esc(vm.label)}</b>${vm.canShort ? "" : " (spot only)"}${digest}${c.userId ? "" : "\nNot linked: /link CODE from the Account page."}\n\nAlerts, digest and weekly review are delivered here in Telegram${c.isGroup ? " (in your private chat with me)" : ""} as well as push and email per your website settings.`, { html: true, keyboard: kb });
}
/** Automatic confirmed-trade messages. In a private chat it is the user's switch; in a group it is the group's. */
async function signals(c: ChatCtx, arg: string) {
  const table = c.isGroup ? "telegram_chats" : "telegram_users";
  const keyCol = c.isGroup ? "chat_id" : "tg_user_id";
  const keyVal = c.isGroup ? c.chatId : c.tgUserId;
  const want = /^(on|yes|1|start)$/i.test(arg) ? true : /^(off|no|0|stop|mute)$/i.test(arg) ? false : null;
  if (want != null) {
    if (c.isGroup) await c.sb.from("telegram_chats").upsert({ chat_id: c.chatId, broadcast: want, updated_at: new Date().toISOString() });
    else await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, user_id: c.userId, venue: c.venue, broadcast: want, updated_at: new Date().toISOString() });
  }
  const { data } = await c.sb.from(table).select("broadcast").eq(keyCol, keyVal).maybeSingle();
  const on = data?.broadcast !== false;
  const scope = c.isGroup ? "this group" : "you";
  return tgSend(c.chatId, `${who(c)}<b>📣 Confirmed-trade signals for ${scope}: ${on ? "ON" : "OFF"}</b>\n${on ? `Every time the engine confirms a new trade${c.isGroup ? "" : ` tradeable on ${esc(VENUE_META[c.venue].label)}`}, one message arrives here with the share card, the full copy-trade block and the action buttons.` : "No automatic messages. Commands and alerts still work."}`, { html: true, keyboard: [[{ text: on ? "🔕 Turn off" : "🔔 Turn on", callback_data: `signals:${on ? "off" : "on"}` }, { text: "Settings", callback_data: "settings" }]] });
}
async function settingsSet(c: ChatCtx, key: string, val?: string) {
  if (key === "unlink") return unlink(c);
  if (!c.userId) return needLink(c);
  if (key === "digest") await c.sb.from("profiles").update({ digest_enabled: val === "1" }).eq("id", c.userId);
  if (key === "hour") await c.sb.from("profiles").update({ digest_hour: Math.max(0, Math.min(23, Number(val) || 0)) }).eq("id", c.userId);
  return settings(c);
}

// ---------- inline mode ----------

/** `@AsheSignalBot SOL` typed in any chat: returns setup summaries the user can drop into the conversation. */
export async function handleInline(sb: SupabaseClient, q: { id: string; query: string; from?: { id: number } }) {
  const text = q.query.trim();
  const results: any[] = [];
  if (text.length >= 2) {
    const actor = q.from ? await loadActor(sb, String(q.from.id), String(q.from.id)) : null;
    const venue = actor?.venue ?? "binance";
    const first = text.split(/\s+/)[0];
    if (classifyAddress(first) !== "unknown") {
      const r = await safe(scanAddress(first, ["1h", "4h"]));
      if (r.ok && r.data.token) {
        const rep = r.data; const d = buildSpecDetail(rep, "watch");
        const tok = rep.token!;
        const sym = tok.symbol.toUpperCase();
        const tgt = d.targets.justified && d.targets.side ? `\n${d.targets.side}: ${d.targets.tp.map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")} · ${d.targets.sl.map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")}` : `\n${esc(d.targets.note)}`;
        const body = `<b>${esc(tok.name)} (${esc(sym)})</b> on ${esc(rep.chain?.name ?? "unknown chain")} · risk <b>${esc(rep.verdict.riskLevel)}</b>\nPrice ${fmtUsd(rep.market.priceUsd)} · liq ${fmtUsd(rep.market.liquidityUsd, { compact: true })} · 24h ${rep.market.change.h24 == null ? "n/a" : `${rep.market.change.h24 >= 0 ? "+" : ""}${rep.market.change.h24.toFixed(1)}%`}\n${esc(rep.verdict.summary)}${tgt}\n<code>${esc(rep.address)}</code>\n<i>AsheSignal scanner. Speculative. Not financial advice.</i>`;
        results.push({ type: "article", id: `scan-${rep.address.slice(0, 40)}`, title: `${sym} on ${rep.chain?.name ?? "?"} · risk ${rep.verdict.riskLevel}`, description: rep.verdict.summary.slice(0, 90), input_message_content: { message_text: body, parse_mode: "HTML" }, reply_markup: link("/") ? { inline_keyboard: [[{ text: "Open in the scanner", url: link(`/scanner?address=${encodeURIComponent(rep.address)}`)! }]] } : undefined });
      }
    }
    const cn = classifyAddress(first) === "unknown" ? await resolveCoin(first) : null;
    if (cn) {
      const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue }, ["4h", "1d"]));
      if (a.ok) for (const tf of ["4h", "1d"] as Timeframe[]) {
        const t = a.data.timeframes[tf]; if (!t || "unavailable" in t) continue;
        const s = t.setup;
        const title = s ? `${cn.symbol} ${s.side} ${tf} · ${s.kind} · conf ${s.confidence}%` : `${cn.symbol} ${tf} · ${t.outlook} · no setup`;
        const body = s ? `<b>${esc(cn.symbol)} ${s.side} ${tf}</b> (${esc(s.kind)}, conf ${s.confidence}%, ${s.riskRewardTp2}R)\nPrice ${fmtUsd(t.price)}\nEntry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}\n${s.takeProfits.slice(0, 3).map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")}\n${s.stopLosses.map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")}\n${esc(a.data.consensus.summary)}\n<i>AsheSignal. Manual trading only. Not financial advice.</i>` : `<b>${esc(cn.symbol)} ${tf}</b>: ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}), RSI ${t.momentum.rsi.toFixed(0)}, price ${fmtUsd(t.price)}.\n${esc(a.data.consensus.summary)}\n<i>AsheSignal. Not financial advice.</i>`;
        results.push({ type: "article", id: `${cn.id}-${tf}`, title, description: s ? `Entry ${fmtUsd(s.entry.low)}-${fmtUsd(s.entry.high)}, SL ${fmtUsd(s.stopLosses[0].price)}, TP1 ${fmtUsd(s.takeProfits[0].price)}` : a.data.consensus.summary.slice(0, 80), input_message_content: { message_text: body, parse_mode: "HTML" }, reply_markup: link("/") ? { inline_keyboard: [[{ text: `Open ${cn.symbol} on AsheSignal`, url: link(`/token/${cn.id}?tf=${tf}`)! }]] } : undefined });
      }
    }
  }
  const { tgAnswerInline } = await import("./telegram");
  return tgAnswerInline(q.id, results, text.length < 2 ? "Type a coin, e.g. SOL" : results.length ? undefined : "No data for that coin or address");
}

// ---------- any token on any chain (contract address) ----------

async function scanCard(c: ChatCtx, raw: string) {
  const addr = raw.trim().split(/\s+/)[0] ?? "";
  if (!addr) return tgSend(c.chatId, "Send a contract address: /scan 0x... or a Solana mint address.");
  if (classifyAddress(addr) === "unknown") return tgSend(c.chatId, "That does not look like a contract address. For a listed coin use /coin SOL.");
  await tgTyping(c.chatId);
  const r = await safe(scanAddress(addr, ["15m", "1h", "4h"]));
  if (!r.ok) return tgSend(c.chatId, `Scan failed: ${esc(r.error)}`, { html: true });
  const rep = r.data;
  if (!rep.token) return tgSend(c.chatId, `No DEX pair found for <code>${esc(addr)}</code>${rep.chain ? ` on ${esc(rep.chain.name)}` : ""}. ${esc(rep.market.note)}`, { html: true });
  const d = buildSpecDetail(rep, "watch");
  const sym = rep.token.symbol.toUpperCase();
  const riskIcon = rep.verdict.riskLevel === "extreme" ? "🟥" : rep.verdict.riskLevel === "high" ? "🟧" : rep.verdict.riskLevel === "medium" ? "🟨" : "🟩";
  const chg = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const lines = [
    `${who(c)}<b>${esc(rep.token.name)} (${esc(sym)})</b> on <b>${esc(rep.chain?.name ?? "unknown chain")}</b>`,
    `${riskIcon} Risk: <b>${esc(rep.verdict.riskLevel)}</b>. ${esc(rep.verdict.summary)}`,
    `Price ${fmtUsd(rep.market.priceUsd)}${rep.market.priceQuality !== "verified" ? ` (${esc(rep.market.priceQuality)})` : ""} · 1h ${chg(rep.market.change.h1)} · 24h ${chg(rep.market.change.h24)}`,
    `Liquidity ${fmtUsd(rep.market.liquidityUsd, { compact: true })} · vol 24h ${fmtUsd(rep.market.volume24h, { compact: true })} · ${rep.market.marketCap ? `mcap ${fmtUsd(rep.market.marketCap, { compact: true })}` : `FDV ${fmtUsd(rep.market.fdv, { compact: true })}`} · ${rep.market.txns24h} txns${rep.market.ageHours != null ? ` · age ${rep.market.ageHours < 48 ? `${Math.round(rep.market.ageHours)} h` : `${Math.round(rep.market.ageHours / 24)} d`}` : ""}`,
    d.security ? `🔐 Security: ${esc(d.security.summary)}${d.security.flags.length ? ` · ${esc(d.security.flags.slice(0, 3).join(", "))}` : ""}` : `🔐 Security: ${esc(rep.securityNote)}`,
    d.ta ? `📈 TA ${esc(d.ta.timeframe)}: ${esc(d.ta.outlook)} (score ${d.ta.score > 0 ? "+" : ""}${d.ta.score})` : `📈 TA: ${esc(rep.analysisNote)}`,
    d.targets.justified && d.targets.side ? `\n<b>${d.targets.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} levels (speculative)</b>\n${d.targets.tp.map((x) => `${x.label}: ${fmtUsd(x.price)}`).join("\n")}\n${d.targets.sl.map((x) => `${x.label}: ${fmtUsd(x.price)}`).join(" · ")}\nEntry zone: ${esc(d.zones.entry)}` : `\n<b>No technical targets:</b> ${esc(d.targets.note)}`,
    d.attention.length ? `\n<b>Why it has attention:</b> ${esc(d.attention.slice(0, 2).join(" "))}` : "",
    d.risks.length ? `<b>Risks:</b> ${esc(d.risks.slice(0, 3).join(" "))}` : "",
    rep.tradingActivity.flags.length ? `<b>Trading flags:</b> ${esc(rep.tradingActivity.flags.slice(0, 2).join(" "))}` : "",
    `\n<code>${esc(rep.address)}</code>`,
    `<i>Speculative. Size with money you can lose entirely. Manual trading only. Not financial advice.</i>`,
  ].filter(Boolean);
  const kb: Keyboard = [];
  const row: Keyboard[number] = [];
  if (d.links.dexscreener) row.push({ text: "DexScreener", url: d.links.dexscreener });
  if (rep.chain?.explorer) row.push({ text: "Explorer", url: `${rep.chain.explorer}${rep.address}` });
  if (link("/")) row.push({ text: "Full scan", url: link(`/scanner?address=${encodeURIComponent(rep.address)}`)! });
  if (row.length) kb.push(row);
  if (c.userId) kb.push([{ text: "🔔 Whale alert", callback_data: `wa:${rep.address}` }, { text: "Menu", callback_data: "menu" }]);
  else kb.push([{ text: "Menu", callback_data: "menu" }]);
  const out = lines.join("\n");
  return tgSend(c.chatId, out.length > 4000 ? out.slice(0, 3990) + "…" : out, { html: true, keyboard: kb });
}
async function whaleAlert(c: ChatCtx, address: string) {
  if (!c.userId) return needLink(c);
  const r = await safe(scanAddress(address, []));
  const symbol = r.ok && r.data.token ? r.data.token.symbol.toUpperCase() : "TOKEN";
  const ok = await createAlert(c, { asset_key: `addr:${address}`, symbol, type: "whale_transfer", params: { usd: 10000 }, asset_ref: { symbol, address }, channels: ["push", "email", "telegram"] });
  return tgSend(c.chatId, ok ? `🔔 Whale alert set for ${esc(symbol)}: transfers of $10,000 or more.` : "Could not save the alert.", { html: true });
}

// ---------- free text ----------

async function freeText(c: ChatCtx, text: string) {
  // A contract address on any chain opens the scanner card.
  const addr = text.trim().split(/\s+/)[0];
  if (addr && classifyAddress(addr) !== "unknown") return scanCard(c, addr);
  // A bare ticker ("SOL", "$btc", "link 1d") opens the coin card directly.
  const m = text.trim().match(/^\$?([a-z0-9]{2,10})(?:\s+(1h|4h|1d))?$/i);
  if (m && !/^(hi|hey|yo|ok|yes|no|thanks|thank|help|menu|start|today|trades)$/i.test(m[1])) {
    const cn = await resolveCoin(m[1]);
    if (cn && cn.symbol.toUpperCase() === m[1].toUpperCase()) return setupCard(c, cn.id, (m[2] as Timeframe) || "4h", cn);
  }
  await tgTyping(c.chatId);
  try {
    const a = await answer({ question: text, venue: c.venue, userId: c.userId, sb: c.userId ? c.sb : null, adminSb: c.sb });
    const body = [esc(a.text), ...(a.bullets?.length ? ["", ...a.bullets.map((b) => `• ${esc(b)}`)] : [])].join("\n");
    const kb: Keyboard = [];
    if (a.context?.coin && (a.context.coin as any).id) kb.push([{ text: `${(a.context.coin as any).symbol} setup card`, callback_data: `setup:${ref(a.context.coin as any)}:4h` }]);
    if (a.links[0] && link(a.links[0].href)) kb.push([{ text: a.links[0].label, url: link(a.links[0].href)! }, { text: "Menu", callback_data: "menu" }]);
    return tgSend(c.chatId, body + "\n\n<i>Not financial advice. Manual trading only.</i>", { html: true, keyboard: kb });
  } catch (e) {
    return tgSend(c.chatId, `Could not answer right now: ${esc((e as Error).message)}`, { html: true });
  }
}
