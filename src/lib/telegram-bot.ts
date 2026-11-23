// The Telegram bot's brain: commands and button callbacks that mirror the app. Every number comes from the
// same engine functions the website uses. Nothing here places orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSend, tgPhoto, tgCardImages, fetchImage, tgEdit, tgAnswerCallback, tgTyping, esc, linkCode, REPLY_KEYBOARD, type Keyboard } from "./telegram";
import { answer } from "./ai/assistant";
import { globalConditions, summarize } from "./market/conditions";
import { marketRegime } from "./market/regime";
import { analyzeScreen } from "./market/analyze";
import { signalView, ago } from "./market/signal-state";
import { buildHeadline } from "./headline";
import { cleanFilters, filtersLabel, FILTER_TFS, type SignalFilters } from "./telegram-broadcast";
import { buildRecap } from "./recap";
import { PRESETS, PRESET_IDS, type PresetId } from "./ledger";
import { CARD_BGS } from "./card-presets";
import { setupBriefing, SQUIXI } from "./mascot";
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
import { buildPlan } from "./plan";
import { buildTrackRecord } from "./track-record";
import { simulate, SIM_DEFAULTS } from "./simulator";
import { buildRadar } from "./radar";
import { planLadder, resolveZone } from "./dca";
import { buildMovers } from "./movers";
import { LESSONS } from "./academy";
import { globalConditions as conditionsForEvents } from "./market/conditions";
import { safe } from "./fetch";
import type { Timeframe } from "./types";
import type { Opportunity } from "./market/opportunities";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (path: string) => (SITE() ? `${SITE()}${path}` : undefined);

export interface ChatCtx { sb: SupabaseClient; chatId: string; tgUserId: string; firstName?: string; userId: string | null; venue: VenueId; isGroup: boolean; state: any; messageId?: number; fromButton?: boolean; /** text of the bot message the user replied to */ quoted?: string | null }

/**
 * Menus: a short main menu of sections, each opening a sub-menu in place (the same message is edited, so the chat
 * does not fill up). At most two buttons per row with short labels, so every label fits on a phone.
 */
type MenuId = "main" | "market" | "trading" | "alerts" | "tools" | "group" | "settings";
const BACK: Keyboard[number] = [{ text: "⬅️ Back", callback_data: "menu" }];
function menuFor(c: ChatCtx, id: MenuId = "main"): Keyboard {
  switch (id) {
    case "market": return [
      [{ text: "✅ Confirmed", callback_data: "cat:confirmed" }, { text: "👀 Watching", callback_data: "cat:watching" }],
      [{ text: "⚠️ Speculative", callback_data: "cat:speculative" }, { text: "🏦 Spot picks", callback_data: "cat:spot" }],
      [{ text: "🏆 Top 3", callback_data: "top" }, { text: "📊 Screener", callback_data: "screener:score" }],
      [{ text: "🌡 Market today", callback_data: "today" }, { text: "📆 Events", callback_data: "events" }],
      [{ text: "🚀 Movers", callback_data: "movers" }],
      BACK,
    ];
    case "trading": return [
      [{ text: "👤 My trades", callback_data: "me" }, { text: "✍️ Record trade", callback_data: "ask:take" }],
      [{ text: "📒 Journal", callback_data: "journal" }, { text: "🌡 My risk", callback_data: "heat" }],
      [{ text: "📅 Week review", callback_data: "review" }, { text: "📐 Size a trade", callback_data: "ask:size" }],
      [{ text: "📊 Signals recap", callback_data: "recap" }, { text: "🏆 Track record", callback_data: "record" }],
      [{ text: "📡 Holdings radar", callback_data: "radar" }, { text: "📖 Trade guide", callback_data: "guide" }],
      BACK,
    ];
    case "alerts": return [
      [{ text: "🔔 My alerts", callback_data: "alerts" }, { text: "➕ Price alert", callback_data: "ask:alert" }],
      [{ text: c.isGroup ? "⭐ Group list" : "⭐ Watchlist", callback_data: "watchlist" }, { text: "➕ Watch a coin", callback_data: "ask:watch" }],
      [{ text: "📣 Auto signals", callback_data: "signals" }, { text: "☀️ Digest now", callback_data: "digest" }],
      BACK,
    ];
    case "tools": return [
      [{ text: "🔍 Coin or token", callback_data: "ask:coin" }, { text: "⚖️ Compare", callback_data: "ask:compare" }],
      [{ text: "🧮 Simulator", callback_data: "simulate" }, { text: "📈 Track record", callback_data: "record" }],
      [{ text: "🪜 DCA plan", callback_data: "ask:dca" }, { text: "🎓 Learn", callback_data: "learn" }],
      [{ text: "🤖 Ask the AI", callback_data: "askai" }, { text: "🧹 New AI chat", callback_data: "newchat" }],
      BACK,
    ];
    case "group": return [
      [{ text: "🏅 Leaderboard", callback_data: "leaderboard" }, { text: "🙋 Join board", callback_data: "optin:1" }],
      [{ text: "⭐ Group list", callback_data: "watchlist" }, { text: "➕ Add to list", callback_data: "ask:watch" }],
      BACK,
    ];
    case "settings": return [
      [{ text: "🏦 Exchange", callback_data: "exchange" }, { text: "⚙️ Settings", callback_data: "settings" }],
      [{ text: c.userId ? "🔓 Unlink" : "🔗 Link account", callback_data: c.userId ? "settings:unlink" : "ask:link" }, { text: "❓ Help", callback_data: "help" }],
      BACK,
    ];
    default: return [
      [{ text: "🤖 Ask the AI anything", callback_data: "askai" }],
      [{ text: "☀️ Today's plan", callback_data: "plan" }, { text: "✅ Confirmed", callback_data: "cat:confirmed" }],
      [{ text: "📊 Market", callback_data: "sub:market" }, { text: "👤 My trading", callback_data: "sub:trading" }],
      [{ text: "🔔 Alerts & list", callback_data: "sub:alerts" }, { text: "🔍 Tools", callback_data: "sub:tools" }],
      ...(c.isGroup ? [[{ text: "👥 Group", callback_data: "sub:group" }, { text: "⚙️ Settings", callback_data: "sub:settings" }]] : [[{ text: "⚙️ Settings", callback_data: "sub:settings" }, { text: "❓ Help", callback_data: "help" }]]),
    ];
  }
}
const MENU_TITLE: Record<MenuId, string> = {
  main: "Pick a section:",
  market: "<b>📊 Market</b>\nWhat the engine sees right now.",
  trading: "<b>👤 My trading</b>\nYour open trades, journal and risk.",
  alerts: "<b>🔔 Alerts & watchlist</b>\nWhat to tell you, and which coins to follow.",
  tools: "<b>🔍 Tools</b>\nLook up any coin or token, compare, plan a DCA, learn, test the rules.",
  group: "<b>👥 Group</b>\nLeaderboard and the shared watchlist.",
  settings: "<b>⚙️ Settings</b>\nExchange, account link, help.",
};
async function showSub(c: ChatCtx, id: MenuId) {
  const text = id === "main" ? menuHeader(c) : MENU_TITLE[id];
  // From a button: edit the menu in place. From a command: send it.
  if (c.messageId && c.fromButton && (await tgEdit(c.chatId, c.messageId, text, menuFor(c, id)))) return true;
  return tgSend(c.chatId, text, { html: true, keyboard: menuFor(c, id) });
}
function menuHeader(c: ChatCtx) {
  const vm = VENUE_META[c.venue];
  return `<b>AsheSignal</b>${c.isGroup && c.firstName ? ` for ${esc(c.firstName)}` : ""}\nExchange: <b>${esc(vm.label)}</b>${vm.canShort ? "" : " (spot, longs only)"}${c.userId ? "" : "\nNot linked yet: Settings, then Link account."}\n\nPick a section:`;
}

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
      return sendMenu(c, true);
    }
    case "/keyboard": return sendMenu(c, true);
    case "/menu": return sendMenu(c);
    case "/help": return help(c);
    case "/link": return arg ? linkAccount(c, arg) : askStart(c, "link");
    case "/unlink": return unlink(c);
    case "/trades": case "/confirmed": return category(c, "confirmed");
    case "/watching": return category(c, "watching");
    case "/spec": case "/speculative": return category(c, "speculative");
    case "/spot": return category(c, "spot");
    case "/today": case "/conditions": return today(c);
    case "/regime": return today(c);
    case "/coin": return arg ? coin(c, arg) : askStart(c, "coin");
    case "/scan": case "/token": case "/ca": return arg ? scanCard(c, arg) : askStart(c, "scan");
    case "/screener": return screener(c, arg || "score");
    case "/size": return arg ? size(c, arg) : askStart(c, "size");
    case "/alert": return arg ? alertCreate(c, arg) : askStart(c, "alert");
    case "/alerts": return alertsList(c);
    case "/me": return me(c);
    case "/journal": return journal(c);
    case "/take": return arg ? takeStart(c, arg) : askStart(c, "take");
    case "/exchange": return exchange(c, arg);
    case "/watch": case "/star": return !arg ? askStart(c, "watch") : c.isGroup ? groupWatchAdd(c, arg) : watchAdd(c, arg);
    case "/unwatch": return c.isGroup ? groupWatchRemove(c, arg) : watchRemove(c, arg);
    case "/watchlist": return c.isGroup ? groupWatchlist(c) : watchlist(c);
    case "/mywatch": return watchAdd(c, arg);
    case "/plan": return plan(c);
    case "/ask": case "/ai": return arg ? aiChat(c, arg) : askAiPrompt(c);
    case "/newchat": case "/forget": return aiReset(c);
    case "/simulate": case "/sim": return simulateCmd(c, arg);
    case "/holdings": case "/radar": return radar(c);
    case "/dca": return arg ? dcaCmd(c, arg) : askStart(c, "dca");
    case "/movers": case "/gainers": return movers(c);
    case "/learn": case "/academy": return learnList(c);
    case "/compare": case "/vs": return arg.trim().split(/\s+/).filter(Boolean).length >= 2 ? compare(c, arg) : askStart(c, "compare");
    case "/events": case "/calendar": return events(c);
    case "/heat": return heat(c);
    case "/record": case "/trackrecord": return record(c);
    case "/recap": case "/week": return recap(c);
    case "/speculative": case "/spec": return speculative(c, arg);
    case "/leaderboard": case "/lb": return leaderboard(c);
    case "/optin": return optIn(c, true);
    case "/optout": return optIn(c, false);
    case "/top": return top(c);
    case "/review": return review(c);
    case "/digest": return digestNow(c);
    case "/settings": return settings(c);
    case "/signals": return signals(c, arg);
    case "/guide": return tgSend(c.chatId, `<b>How to place a trade on ${esc(VENUE_META[c.venue].label)}</b>\nShort version: limit order inside the entry zone, stop loss attached, take-profits in parts (30/30/40), stop to break-even after TP1. The full click-by-click guide with your numbers opens from any setup card.${VENUE_META[c.venue].canShort ? "" : `\n\n${esc(VENUE_META[c.venue].label)} is spot only: SHORT setups cannot be opened there.`}`, { html: true, keyboard: [[{ text: "Open the trade guide", url: link(`/guide?venue=${c.venue}`) ?? "https://t.me" }]] });
    case "/cancel": await setState(c, null); return tgSend(c.chatId, "Cancelled.");
    case "/askcoin": return askStart(c, "coin");
    case "/asksize": return askStart(c, "size");
    case "/untake": case "/close": return me(c);
    default: {
      const mapped = labelToCommand(fullText);
      if (mapped) return handleCommand(c, mapped, "", mapped);
      return freeText(c, fullText);
    }
  }
}

export async function handleCallback(c: ChatCtx, data: string, callbackId: string) {
  c.fromButton = true;
  await tgAnswerCallback(callbackId);
  const [kind, a, b, d] = data.split(":");
  switch (kind) {
    case "menu": return showSub(c, "main");
    case "sub": return showSub(c, (a as MenuId) || "main");
    case "journal": return journal(c);
    case "guide": return handleCommand(c, "/guide", "", "/guide");
    case "ask": return askStart(c, a);
    case "cancelflow": await setState(c, null); return tgSend(c.chatId, "Cancelled.", { keyboard: [[{ text: "Menu", callback_data: "menu" }]] });
    case "askdir": return askDir(c, a);
    case "howcoin": return tgSend(c.chatId, "Send a ticker or a contract address, for example:\n<code>SOL</code> or <code>/coin SOL 1d</code>\n<code>/scan 0x...</code> or just paste the address\nIn any chat: type <code>@AsheSignalBot SOL</code> to share a card.", { html: true });
    case "howsize": return tgSend(c.chatId, "Position size: <code>/size ENTRY STOP [balance] [risk%]</code>\nExample: <code>/size 0.594 0.583 500 1</code>\nLinked accounts can leave out balance and risk%; the Risk page values are used.", { html: true, keyboard: [...(link("/") ? [[{ text: "Full calculator", url: link("/risk")! }]] : [])] });
    case "howlink": return needLink(c);
    case "cat": return category(c, a as any, Number(b ?? 0));
    case "today": return today(c);
    case "screener": return screener(c, a ?? "score");
    case "me": return me(c);
    case "alerts": return alertsList(c);
    case "help": return help(c);
    case "exchange": return a ? setExchange(c, a) : exchange(c, "");
    case "coin": return coin(c, a, (b as Timeframe) || undefined);
    case "setup": return setupCard(c, a, (b as Timeframe) || null);
    case "scan": return scanCard(c, a);
    case "wa": return whaleAlert(c, a);
    case "copy": return copySetup(c, a, (b as Timeframe) || "4h");
    case "take": return takeStart(c, a, (b as Timeframe) || "4h", d === "paper");
    case "alerttp": return alertFromSetup(c, a, (b as Timeframe) || "4h");
    case "confirmalert": return alertConfirm(c, a);
    case "zonealert": return alertZone(c, a, (b as Timeframe) || "4h");
    case "watch": return a === "rm" ? (c.isGroup ? groupWatchRemove(c, b) : watchRemove(c, b)) : c.isGroup ? groupWatchAdd(c, a) : watchAdd(c, a);
    case "watchlist": return c.isGroup ? groupWatchlist(c) : watchlist(c);
    case "plan": return plan(c);
    case "askai": return askAiPrompt(c);
    case "newchat": return aiReset(c);
    case "simulate": return simulateCmd(c, a ? `${a} ${b ?? ""}` : "");
    case "radar": return radar(c);
    case "movers": return movers(c);
    case "learn": return learnList(c);
    case "lesson": return lessonShow(c, Number(a));
    case "lq": return quizAsk(c, Number(a), Number(b));
    case "la": return quizAnswer(c, Number(a), Number(b), Number(d));
    case "events": return events(c);
    case "heat": return heat(c);
    case "record": return record(c);
    case "recap": return recap(c);
    case "card": return resultCard(c, a, Number(b) || 0, d === "1");
    case "sigf": return signalFilter(c, a ?? "", b ?? "");
    case "explain": return explainSetup(c, a, (b as Timeframe) || "4h");
    case "leaderboard": return leaderboard(c);
    case "optin": return optIn(c, a !== "0");
    case "top": return top(c);
    case "review": return review(c);
    case "digest": return digestNow(c);
    case "settings": return a ? settingsSet(c, a, b) : settings(c);
    case "signals": return signals(c, a ?? "");
    case "spec": return speculative(c, a ?? "");
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
  if (st.flow === "ask") return askStep(c, text);
  return false;
}

/** Reply-keyboard labels and plain words that map to commands, so nothing needs a slash. */
const LABELS: Record<string, string> = {
  "☀️ plan": "/plan", plan: "/plan", "✅ trades": "/trades", trades: "/trades", confirmed: "/trades", "👀 watching": "/watching", watching: "/watching",
  "🔍 coin": "/askcoin", coin: "/askcoin", scan: "/askcoin", "📐 size": "/asksize", size: "/asksize", "👤 me": "/me", me: "/me", "my trades": "/me",
  "📋 menu": "/menu", menu: "/menu", "🤖 ask ai": "/ask", "ask ai": "/ask", "⭐ watchlist": "/watchlist", watchlist: "/watchlist", "🔔 alerts": "/alerts", alerts: "/alerts",
  today: "/today", spot: "/spot", spec: "/spec", speculative: "/spec", top: "/top", screener: "/screener", record: "/record", events: "/events", heat: "/heat",
  holdings: "/holdings", radar: "/holdings", movers: "/movers", gainers: "/movers", learn: "/learn", academy: "/learn", dca: "/dca",
  review: "/review", digest: "/digest", settings: "/settings", help: "/help", journal: "/journal", guide: "/guide", exchange: "/exchange", simulate: "/simulate", simulator: "/simulate",
};
export function labelToCommand(text: string): string | null { return LABELS[text.trim().toLowerCase()] ?? null; }

// ---------- "ask" flows: every command that needs an argument can be driven by buttons ----------

const ASK_PROMPTS: Record<string, string> = {
  coin: "Which coin? Send a ticker like <code>SOL</code>, a name, or a contract address (any chain). Add a timeframe if you like: <code>SOL 1d</code>.",
  scan: "Paste the contract address (Solana, Ethereum, Base, BNB, Polygon, Arbitrum, Avalanche, Optimism, Sui, TON...).",
  size: "Position size. Send <b>entry price</b> and <b>stop price</b> separated by a space, e.g. <code>0.594 0.583</code>. Add balance and risk% if you are not linked: <code>0.594 0.583 500 1</code>.",
  alert: "Price alert. Which coin? Send a ticker like <code>BTC</code>.",
  take: "Record a trade. Which coin did you trade? Send a ticker like <code>SOL</code> (add 1h/4h/1d for the timeframe).",
  watch: "Add to the watchlist. Which coin? Send a ticker like <code>SOL</code>.",
  compare: "Compare two coins. Send both tickers, e.g. <code>BTC ETH</code> (optionally a timeframe: <code>BTC ETH 1d</code>).",
  link: "Link your account. Open the website, Account page, Telegram section, and send me the 6-character code shown there.",
  dca: "DCA plan. Send the coin and your budget in dollars, e.g. <code>BTC 200</code> (optionally the number of orders: <code>BTC 200 5</code>).",
};
async function askStart(c: ChatCtx, kind: string) {
  if (!ASK_PROMPTS[kind]) return sendMenu(c);
  if (kind === "link" && c.userId) return tgSend(c.chatId, "Already linked. Use Settings to unlink.", { keyboard: [[{ text: "Settings", callback_data: "settings" }]] });
  if (["alert", "take", "watch", "link"].includes(kind) && !c.userId && kind !== "link") return needLink(c);
  if (c.isGroup && ["take", "alert", "link", "size"].includes(kind)) return tgSend(c.chatId, `${who(c)}Open a private chat with me for that one (tap my name, then Start), so your numbers are not posted in the group.`, { html: true });
  await setState(c, { flow: "ask", kind, step: 1, data: {} });
  return tgSend(c.chatId, `${ASK_PROMPTS[kind]}\nSend /cancel to stop.`, { html: true, keyboard: [[{ text: "✖ Cancel", callback_data: "cancelflow" }]] });
}
async function askDir(c: ChatCtx, dir: string) {
  const st = c.state; if (st?.flow !== "ask" || st.kind !== "alert" || !st.data?.coin) return sendMenu(c);
  st.data.dir = dir === "below" ? "below" : "above"; st.step = 3; await setState(c, st);
  return tgSend(c.chatId, `Alert when ${esc(st.data.coin.symbol)} goes <b>${st.data.dir}</b> which price? (current ${st.data.price ? fmtUsd(st.data.price) : "unknown"})`, { html: true });
}
async function askStep(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state; const t = text.trim();
  if (!t) return true;
  const done = async () => setState(c, null);
  switch (st.kind) {
    case "coin": await done(); await (classifyAddress(t.split(/\s+/)[0]) !== "unknown" ? scanCard(c, t) : coin(c, t)); return true;
    case "scan": await done(); await scanCard(c, t); return true;
    case "size": await done(); await size(c, t); return true;
    case "take": await done(); { const [q, tf] = t.split(/\s+/); await takeStart(c, q, (["1h", "4h", "1d", "15m", "1w"].includes(tf) ? tf : "4h") as Timeframe); } return true;
    case "watch": await done(); await (c.isGroup ? groupWatchAdd(c, t) : watchAdd(c, t)); return true;
    case "compare": { const parts = t.split(/\s+/).filter(Boolean); if (parts.length < 2) { await tgSend(c.chatId, "Send two tickers, e.g. BTC ETH."); return true; } await done(); await compare(c, t); return true; }
    case "link": await done(); await linkAccount(c, t); return true;
    case "dca": await done(); await dcaCmd(c, t); return true;
    case "alert": {
      if (st.step === 1) {
        const cn = await resolveCoin(t.split(/\s+/)[0]); if (!cn) { await tgSend(c.chatId, `Could not find "${esc(t)}". Try the ticker.`, { html: true }); return true; }
        const mk = await safe(getMarketsByIds([cn.id])); const price = mk.ok ? mk.data[0]?.priceUsd ?? null : null;
        st.data = { coin: cn, price }; st.step = 2; await setState(c, st);
        await tgSend(c.chatId, `${esc(cn.symbol)}${price ? ` is ${fmtUsd(price)}` : ""}. Alert when it goes:`, { html: true, keyboard: [[{ text: "⬆️ Above a price", callback_data: "askdir:above" }, { text: "⬇️ Below a price", callback_data: "askdir:below" }], [{ text: "✅ When it confirms", callback_data: `confirmalert:${ref(cn)}` }, { text: "✖ Cancel", callback_data: "cancelflow" }]] });
        return true;
      }
      if (st.step === 2) { const d = /below|under|down/i.test(t) ? "below" : /above|over|up/i.test(t) ? "above" : null; if (!d) { await tgSend(c.chatId, "Tap Above or Below."); return true; } await askDir(c, d); return true; }
      if (st.step === 3) { const price = Number(t.replace(/[$,]/g, "")); if (!(price > 0)) { await tgSend(c.chatId, "Send the price as a number."); return true; } await done(); await alertCreate(c, `${st.data.coin.symbol} ${st.data.dir} ${price}`); return true; }
      return true;
    }
    default: await done(); return false;
  }
}

// ---------- screens ----------

async function sendMenu(c: ChatCtx, withReplyKeyboard = false) {
  const vm = VENUE_META[c.venue];
  if (withReplyKeyboard && !c.isGroup) await tgSend(c.chatId, "Buttons are under the text box: Plan, Trades, Coin, Size, Me, Menu and more. You never have to type a command.", { replyKeyboard: REPLY_KEYBOARD });
  void vm;
  return showSub(c, "main");
}

async function help(c: ChatCtx) {
  const lines = [
    "<b>Discovery</b>",
    "/trades /watching /spec /spot - the four categories, filtered to your exchange",
    "/top - 3 best confirmed for your exchange · /plan - today's plan · /today - conditions, regime, Fear & Greed",
    "/screener [score|oversold|overbought|volume] · /record - engine track record",
    "<b>Coins</b>",
    "/coin SOL [1h|4h|1d] or just SOL · /scan ADDRESS or paste an address (any chain)",
    "@AsheSignalBot SOL in any chat shares a card (inline)",
    "<b>Trading</b>",
    "/size ENTRY STOP [balance] [risk%] · /take SOL (guided, with pre-trade check) · /me then Close or Cancel",
    "/journal · /review · /digest · /guide",
    "<b>Alerts and watchlist</b>",
    "/alert BTC above 100000 · /alerts · /watch SOL · /unwatch SOL · /watchlist · /mywatch SOL (groups: personal list)",
    "/signals on|off - automatic message for every new confirmed trade",
    "<b>Groups</b>",
    "/leaderboard · /optin · /optout · /watch and /watchlist act on the group's shared list",
    "<b>Account</b>",
    "/link CODE (from the Account page) · /unlink · /exchange coinbase · /settings · /menu · /cancel",
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
  // Same one-line answer as the top of the website's dashboard.
  const hl = await safe(buildHeadline(c.sb, c.venue));
  const lines = [
    `<b>Today</b>`,
    ...(hl.ok ? [`${hl.data.tone === "down" ? "🔴" : hl.data.tone === "up" ? "🟢" : "🟡"} <b>${esc(hl.data.title)}.</b> ${esc(hl.data.stance)} <b>${esc(hl.data.move)}</b>`, ""] : []),
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
  let whyText = "";
  if (!items.length && cat === "confirmed") {
    // Say why, in plain words: what is blocking the watched setups and which ideas are closest.
    const all = await safe(loadDiscovery(c.sb, { venue: c.venue, verifyBudgetMs: 1 }));
    const w = all.ok ? all.data.why : null;
    if (w) whyText = `${esc(w.headline)}${w.blockers.length ? `\n\n<b>What is missing most often</b>\n${w.blockers.slice(0, 3).map((b) => `- ${esc(b.label)} (${b.count}): ${esc(b.plain)}`).join("\n")}` : ""}${w.closest.length ? `\n\n<b>Closest to confirming</b>\n${w.closest.slice(0, 3).map((x) => `- <b>${esc(x.symbol)}</b> ${x.side} ${esc(x.tf ?? "")}: ${esc(x.missing)}`).join("\n")}` : ""}\n\nNo signal is also a signal. Waiting is fine.`;
  }
  if (!slice.length) return tgSend(c.chatId, `${head}\n\n${whyText || (cat === "confirmed" ? "Nothing qualifies right now. That is normal in quiet or risk-off markets; check Watching." : "Nothing here right now.")}`, { html: true, keyboard: [[{ text: "Watching", callback_data: "cat:watching" }, { text: "Menu", callback_data: "menu" }]] });
  const lines = slice.map((i, idx) => {
    const n = page * per + idx + 1;
    const s = (i.detail as any)?.setup;
    if (cat === "spot") { const sp = i.spot!; const z = sp.analysis.accumulation; const inZone = i.price != null && i.price >= z.low && i.price <= z.high; return `${n}. <b>${esc(i.symbol)}</b> ${esc(sp.tier)} · score ${sp.score} · ${fmtUsd(i.price)}\n   zone ${fmtUsd(z.low)} to ${fmtUsd(z.high)}${inZone ? " · <b>in zone</b>" : ""}`; }
    if (cat === "speculative") { const sp = i.spec!; return `${n}. <b>${esc(i.symbol)}</b> ${esc(i.chain ?? "")} · ${fmtUsd(i.price)} · liq ${fmtUsd(i.liquidity, { compact: true })} · risk ${esc(i.risk)}\n   ${esc(sp.attention[0] ?? "")}`; }
    if (s) return `${n}. <b>${esc(i.symbol)}</b> ${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(i.timeframe)} · score ${s.confidence}/100 · ${s.rr}R\n   entry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)} · SL ${fmtUsd(s.stopLosses[0]?.price)} · TP1 ${fmtUsd(s.takeProfits[0]?.price)}${cat === "watching" && (i.detail as any)?.watch?.[0] ? `\n   watching: ${esc((i.detail as any).watch[0].what)}` : ""}`;
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
  return setupCard(c, cn.id, tf ?? null, cn);
}

/** The plan every button acts on: the frozen levels of an active Confirmed signal, else the live setup. One rule,
 *  same candles as the screener, so Copy, Size, Take and the alerts always match the card and the signal message. */
async function planFor(c: ChatCtx, cn: { id: string; symbol: string }, tf: Timeframe) {
  const [sig, a] = await Promise.all([safe(signalView(c.sb, cn, tf)), safe(analyzeScreen({ symbol: cn.symbol, coingeckoId: cn.id }, [tf]))]);
  const tt = a.ok ? a.data.timeframes[tf] : null;
  const t = tt && !("unavailable" in tt) ? tt : null;
  const view = sig.ok ? sig.data : null;
  const s = view?.status === "active" && view.setup ? view.setup : t?.setup ?? null;
  return { t, s, sig: view };
}

async function setupCard(c: ChatCtx, id: string, tfIn: Timeframe | null, known?: { id: string; symbol: string; name: string }) {
  await tgTyping(c.chatId);
  const cn = known ?? (await resolveCoin(id));
  if (!cn) return tgSend(c.chatId, "Coin not found.");
  const [sigR, a] = await Promise.all([safe(signalView(c.sb, cn, tfIn)), safe(analyzeScreen({ symbol: cn.symbol, coingeckoId: cn.id }, ["1h", "4h", "1d"]))]);
  if (!a.ok) return tgSend(c.chatId, `Could not load ${esc(cn.symbol)}: ${esc(a.error)}`, { html: true });
  const sig = sigR.ok ? sigR.data : null;
  const tf: Timeframe = sig?.tf ?? tfIn ?? "4h";
  const t = a.data.timeframes[tf];
  const listings = await venueListings();
  const vs = venuesFor(cn.symbol, listings, c.venue);
  const where = vs.includes(c.venue) ? `Listed on ${VENUE_META[c.venue].label}` : vs.length ? `Not on ${VENUE_META[c.venue].label}; on ${vs.map((v) => VENUE_META[v].label).join(", ")}` : "DEX only";
  const tfRow: Keyboard[number] = (["1h", "4h", "1d"] as Timeframe[]).map((x) => ({ text: (x === tf ? "• " : "") + x, callback_data: `coin:${ref(cn)}:${x}` }));
  if (!t || "unavailable" in t) return tgSend(c.chatId, `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> ${tf}: no data. ${esc(a.data.consensus.summary)}`, { html: true, keyboard: [tfRow, [{ text: "Menu", callback_data: "menu" }]] });
  const active = sig?.status === "active" && !!sig.setup;
  const s = active ? sig!.setup! : t.setup;
  // Which line of the signal system this card sits on. This is the answer to "the bot said Confirmed, why does the
  // card say something else": the card now states the signal's own status first.
  let statusLine = "";
  if (active) statusLine = `\n\n✅ <b>CONFIRMED signal</b> · sent ${esc(ago(sig!.since))} · still active\nLevels are the ones from the signal. It stays Confirmed until the stop or TP1 is reached, or the score fades.`;
  else if (sig?.status === "ended") statusLine = `\n\n⌛ <b>Was Confirmed</b>, signal ended ${esc(ago(sig.endedAt))}.${sig.endReason ? `\n${esc(sig.endReason)}` : ""}\nBelow is the live read, not the old signal.`;
  if (sig?.others.length) statusLine += `\n✅ Also Confirmed on: ${sig.others.map((o) => `${o.tf}${o.side ? ` (${o.side})` : ""}`).join(", ")} (tap the timeframe below).`;
  const head = `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> · ${fmtUsd(t.price)} · ${tf}\n${t.outlook === "strongly bullish" || t.outlook === "bullish" ? "🟢" : t.outlook.includes("bear") ? "🔴" : "🟡"} ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}) · trend ${esc(t.trend.direction)} · RSI ${t.momentum.rsi.toFixed(0)} · vol ${t.volume.ratio.toFixed(2)}x\n${esc(a.data.consensus.summary)}\n${esc(where)}`;
  const levels = t.levels.slice(0, 4).map((l) => `${l.kind === "support" ? "S" : "R"} ${fmtUsd(l.price)}`).join(" · ");
  const pats = [...t.patterns.confirmed.map((p) => `${p.name} ✓`), ...t.patterns.forming.map((p) => `${p.name} (forming)`)].slice(0, 3).join(", ");
  let body = `\n<b>Levels:</b> ${esc(levels || "none")}${pats ? `\n<b>Patterns:</b> ${esc(pats)}` : ""}`;
  const kb: Keyboard = [tfRow];
  if (s) {
    // A live setup that passes the single-timeframe gates is not a signal yet: the screener also checks the higher
    // timeframe, the engine's record and the market regime, and only its scan sends the signal.
    const tag = active ? "✅ CONFIRMED" : s.kind === "confirmed" ? "🟡 passes the chart checks, not a signal yet" : s.kind === "speculative" ? "⚠️ speculative" : "👀 watch";
    body += `\n\n<b>${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} setup · ${tag}</b> · score ${s.confidence}/100 · ${s.riskRewardTp2}R · ${esc(s.style)}\nEntry: ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}\n${s.takeProfits.slice(0, 3).map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`).join("\n")}\n${s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`).join(" · ")}\nLeverage: ${s.leverage.recommended}x recommended (max ${s.leverage.maxSafe}x)`;
    if (!active && s.kind === "confirmed") body += `\n<b>Not a signal yet:</b> ${esc(sig?.screened === false ? "this coin is outside the top 100 the screener scans, so no signals are sent for it. Treat it as your own read." : "the scan runs about once an hour per coin and also checks the higher timeframe, the engine's record and the market regime. If it still holds then, the signal is sent.")}`;
    if (s.kind !== "confirmed" && s.quality.confirmGaps.length) body += `\n<b>Missing for Confirmed:</b> ${esc(s.quality.confirmGaps[0])}`;
    if (s.kind === "watch" && s.quality.issues.length) body += `\n<b>Why only watch:</b> ${esc(s.quality.issues[0])}`;
    if (s.invalidation?.length) body += `\n<b>Invalidated if:</b> ${esc(s.invalidation[0])}`;
    const z = zoneStatus(t.price, s.entry, s.side);
    if (z.state !== "unknown") body += `\n<b>${z.state === "in" ? "🟢" : z.tone === "down" ? "🔴" : "🟡"} Now:</b> ${esc(z.label)}. ${esc(z.advice)}`;
    if (s.side === "SHORT" && !VENUE_META[c.venue].canShort) body += `\n\n${esc(VENUE_META[c.venue].label)} is spot only: treat this SHORT as a sell/reduce signal if you hold ${esc(cn.symbol)}.`;
    kb.push([{ text: "📋 Copy setup", callback_data: `copy:${ref(cn)}:${tf}` }, { text: "📐 Size it", callback_data: `size:${s.entry.mid}:${s.stopLosses[0].price}` }]);
    kb.push([{ text: "🦑 Squixi explains it", callback_data: `explain:${ref(cn)}:${tf}` }]);
    kb.push([{ text: "✍️ I took it", callback_data: `take:${ref(cn)}:${tf}:real` }, { text: "🧪 Paper trade", callback_data: `take:${ref(cn)}:${tf}:paper` }]);
    kb.push([{ text: "🔔 Alert at TP1/SL", callback_data: `alerttp:${ref(cn)}:${tf}` }, { text: "🔔 Entering zone", callback_data: `zonealert:${ref(cn)}:${tf}` }]);
    kb.push([...(!active ? [{ text: "🔔 When it confirms", callback_data: `confirmalert:${ref(cn)}` }] : []), { text: "⭐ Watch", callback_data: `watch:${ref(cn)}` }]);
    const guide = link(`/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: cn.symbol, leverage: String(s.leverage.recommended), venue: c.venue })}`);
    kb.push([{ text: "📖 How to place it", url: guide ?? "https://t.me" }, { text: "🌐 Full page", url: link(`/s/${cn.id}/${tf}`) ?? "https://t.me" }]);
    // Candle chart with the setup drawn on it first (short caption: Telegram caps captions at 1024 chars), then the full card.
    const chart = link(`/api/chart?${new URLSearchParams({ symbol: cn.symbol, id: cn.id, tf, side: s.side, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), sl1: String(s.stopLosses[0].price), sl2: String(s.stopLosses[1]?.price ?? "") })}`);
    const og = link(`/api/og?${new URLSearchParams({ symbol: cn.symbol, tf, side: s.side, kind: active ? "confirmed" : s.kind === "confirmed" ? "unconfirmed" : s.kind, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), sl1: String(s.stopLosses[0].price), sl2: String(s.stopLosses[1]?.price ?? s.stopLosses[0].price), rr: String(s.riskRewardTp2), lev: String(s.leverage.recommended), conf: String(s.confidence), style: s.style, theme: "foundry" })}`);
    // The share card (same PNG as the website's share button) and the chart with levels, as one album above the card text.
    const [cardImg, chartImg] = await Promise.all([og ? fetchImage(og) : null, chart ? fetchImage(chart) : null]);
    await tgCardImages(c.chatId, { card: cardImg, chart: chartImg }, `<b>${esc(cn.symbol)} ${s.side} ${tf}</b> · ${active ? "CONFIRMED signal" : s.kind === "confirmed" ? "not a signal yet" : esc(s.kind)} · score ${s.confidence}/100 · ${s.riskRewardTp2}R`);
    if (og) kb.push([{ text: "🖼 Open share card", url: og }]);
  } else {
    body += `\n\nNo tradeable setup on ${tf}.`;
    kb.push([{ text: "🌐 Full page", url: link(`/s/${cn.id}/${tf}`) ?? "https://t.me" }, { text: "🔔 When it confirms", callback_data: `confirmalert:${ref(cn)}` }, { text: "⭐ Watch", callback_data: `watch:${ref(cn)}` }]);
  }
  kb.push([{ text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, head + statusLine + body, { html: true, keyboard: kb });
}

async function copySetup(c: ChatCtx, id: string, tf: Timeframe) {
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const { s } = await planFor(c, cn, tf);
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
  return tgSend(c.chatId, `<b>📒 Journal (last ${data.length})</b>\n${lines.join("\n")}`, { html: true, keyboard: [[{ text: "🖼 Share my last result", callback_data: "card:last:0:0" }], [{ text: "Open journal", url: link("/setups") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
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
  const { s } = await planFor(c, cn, tf);
  if (!s) return tgSend(c.chatId, "No setup to alert on.");
  const okTp = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_above" : "price_below", params: { price: s.takeProfits[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  const okSl = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_below" : "price_above", params: { price: s.stopLosses[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  return tgSend(c.chatId, okTp && okSl ? `🔔 Two alerts set for ${esc(cn.symbol)}: TP1 ${fmtUsd(s.takeProfits[0].price)} and SL1 ${fmtUsd(s.stopLosses[0].price)}.` : "Could not save the alerts.", { html: true });
}
async function alertZone(c: ChatCtx, id: string, tf: Timeframe) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const { s } = await planFor(c, cn, tf);
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
  const { t, s } = await planFor(c, cn, tf);
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
    st.verdict = pre.ok ? pre.data.verdict : null; await setState(c, st);
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
  const row = { user_id: c.userId, asset_key: `cg:${st.coin.id}`, symbol: st.coin.symbol, timeframe: st.tf, side: st.setup.side, kind: st.setup.kind, entry_low: st.setup.entry.low, entry_high: st.setup.entry.high, tp1: st.setup.takeProfits[0]?.price ?? null, tp2: st.setup.takeProfits[1]?.price ?? null, tp3: st.setup.takeProfits[2]?.price ?? null, sl1: sl ?? null, sl2: st.setup.stopLosses[1]?.price ?? null, rr: st.setup.rr ?? null, leverage: lev, leverage_used: lev, pretrade_verdict: st.paper ? null : st.verdict ?? null, confidence: st.setup.confidence ?? null, payload: st.setup, taken: true, paper: !!st.paper, taken_at: new Date().toISOString(), exchange: st.paper ? "paper" : c.venue, fill_price: st.fill, size_units: units, size_usd: usd, risk_usd: riskUsd, notes: lev > 1 ? `Recorded via Telegram · ${lev}x leverage, margin ${fmtUsd(Number(st.margin))}` : "Recorded via Telegram" };
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
  await tgSend(c.chatId, `🏁 Closed ${esc(row.symbol)} ${row.side} at ${fmtUsd(exit)}${pnl != null ? `: <b>${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}</b>` : ""}${r != null ? ` (${r > 0 ? "+" : ""}${r}R)` : ""}. ${pnl != null && pnl >= 0 ? "Nice." : "Logged; losses that respect the stop are part of the plan."}`, { html: true, keyboard: [[{ text: "🖼 Share result card", callback_data: `card:${row.id}:0:0` }], [{ text: "My trades", callback_data: "me" }, { text: "Weekly review", callback_data: "review" }]] });
  return true;
}

/**
 * A trader's own result as a picture: their fill, their exit, their profit. Buttons under it change the background
 * and show or hide the dollar amount; the website's card studio does the rest (own picture, colours, caption).
 */
async function resultCard(c: ChatCtx, id: string, bgIndex: number, showUsd: boolean) {
  if (!c.userId) return needLink(c);
  const { data: row } = id === "last"
    ? await c.sb.from("saved_setups").select("*").eq("user_id", c.userId).eq("taken", true).not("exit_price", "is", null).order("exit_at", { ascending: false }).limit(1).maybeSingle()
    : await c.sb.from("saved_setups").select("*").eq("id", id).eq("user_id", c.userId).maybeSingle();
  if (!row || row.exit_price == null) return tgSend(c.chatId, "No closed trade to make a card from yet. Close a trade first (My trades, then Close), then tap Share result card.");
  await tgTyping(c.chatId);
  const bg = CARD_BGS[((bgIndex % CARD_BGS.length) + CARD_BGS.length) % CARD_BGS.length];
  const fill = Number(row.fill_price ?? (Number(row.entry_low) + Number(row.entry_high)) / 2);
  const hours = row.taken_at && row.exit_at ? Math.max(1, Math.round((Date.parse(row.exit_at) - Date.parse(row.taken_at)) / 3_600_000)) : null;
  const lev = Number(row.leverage_used ?? 0) > 1 ? Number(row.leverage_used) : null;
  const base: Record<string, string> = { symbol: row.symbol, tf: row.timeframe, side: row.side, entry: String(fill), exit: String(row.exit_price) };
  if (row.sl1 != null) base.sl = String(row.sl1);
  if (lev) base.lev = String(lev);
  if (hours) base.hours = String(hours);
  const usd = row.realized_usd != null ? Math.round(Number(row.realized_usd) * 100) / 100 : null;
  const img = new URLSearchParams({ ...base, mine: "1", bg: bg.id, name: c.firstName ?? "", ...(showUsd && usd != null ? { usd: String(usd) } : {}) });
  const studio = link(`/card?${new URLSearchParams({ ...base, ...(usd != null ? { usd: String(usd) } : {}), bg: bg.id })}`);
  const url = link(`/api/result-card?${img}`);
  const blob = url ? await fetchImage(url) : null;
  const kb: Keyboard = [
    [{ text: `🎨 Background: ${bg.label} (next)`, callback_data: `card:${row.id}:${bgIndex + 1}:${showUsd ? 1 : 0}` }],
    ...(usd != null ? [[{ text: showUsd ? "🙈 Hide the $ amount" : "💵 Show the $ amount", callback_data: `card:${row.id}:${bgIndex}:${showUsd ? 0 : 1}` }]] : []),
    ...(studio ? [[{ text: "✏️ Customise (own picture, colours, caption)", url: studio }]] : []),
  ];
  const caption = `<b>${esc(row.symbol)} ${row.side} ${esc(row.timeframe)}</b>: your result card. Forward it or save the picture to share it anywhere.`;
  if (blob && (await tgPhoto(c.chatId, blob, caption, kb))) return;
  return tgSend(c.chatId, `Could not draw the card right now.${studio ? " You can still make it on the website:" : ""}`, { html: true, keyboard: studio ? [[{ text: "✏️ Open the card studio", url: studio }]] : undefined });
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
  if (mk.ok) for (const m of mk.data as any[]) price.set(m.id, { price: m.priceUsd, chg: m.change24hPct ?? null });
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
    const { data: p } = await c.sb.from("profiles").select("digest_enabled, digest_hour, plan_enabled, plan_hour, email").eq("id", c.userId).maybeSingle();
    const h = Number(p?.digest_hour ?? 13); const ph = Number(p?.plan_hour ?? 12);
    digest = `\nMorning plan: <b>${p?.plan_enabled ? `on, ${String(ph).padStart(2, "0")}:00 UTC` : "off"}</b>\nDaily digest: <b>${p?.digest_enabled ? `on, ${String(h).padStart(2, "0")}:00 UTC` : "off"}</b>\nAccount: ${esc(p?.email ?? "linked")}`;
    kb = [
      [{ text: p?.plan_enabled ? "☀️ Plan off" : "☀️ Morning plan on", callback_data: `settings:plan:${p?.plan_enabled ? "0" : "1"}` }, { text: "⏰ -1", callback_data: `settings:planhour:${(ph + 23) % 24}` }, { text: "⏰ +1", callback_data: `settings:planhour:${(ph + 1) % 24}` }],
      [{ text: p?.digest_enabled ? "🔕 Digest off" : "🔔 Digest on", callback_data: `settings:digest:${p?.digest_enabled ? "0" : "1"}` }, { text: "⏰ -1", callback_data: `settings:hour:${(h + 23) % 24}` }, { text: "⏰ +1", callback_data: `settings:hour:${(h + 1) % 24}` }],
      [{ text: "⚙️ Change exchange", callback_data: "exchange" }, { text: "🔓 Unlink", callback_data: "settings:unlink" }],
    ];
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
  // sig_filters arrives with the Stage 49 schema; without it the toggle still works and the filters say so.
  const full = await c.sb.from(table).select("broadcast, sig_filters").eq(keyCol, keyVal).maybeSingle();
  const hasFilters = !full.error;
  const data = hasFilters ? full.data : (await c.sb.from(table).select("broadcast").eq(keyCol, keyVal).maybeSingle()).data;
  const on = data?.broadcast !== false;
  const f = cleanFilters((data as { sig_filters?: unknown } | null)?.sig_filters);
  const scope = c.isGroup ? "this group" : "you";
  const tfOn = (t: string) => !f.tfs || f.tfs.includes(t);
  const kb: Keyboard = [[{ text: on ? "🔕 Turn off" : "🔔 Turn on", callback_data: `signals:${on ? "off" : "on"}` }, { text: "Settings", callback_data: "settings" }]];
  if (!c.isGroup) kb.push([{ text: "🔍 Speculative alerts", callback_data: "spec" }]);
  if (on && hasFilters) {
    kb.push(FILTER_TFS.map((t) => ({ text: `${tfOn(t) ? "✅" : "⬜"} ${t}`, callback_data: `sigf:tf:${t}` })));
    kb.push([{ text: `${f.longsOnly ? "⬜" : "✅"} Shorts too`, callback_data: `sigf:side:${f.longsOnly ? "all" : "long"}` }, { text: `${f.longsOnly ? "✅" : "⬜"} Longs only`, callback_data: "sigf:side:long" }]);
    kb.push([0, 60, 70, 80].map((n) => ({ text: `${(f.minScore ?? 0) === n ? "✅" : "⬜"} ${n ? `${n}+` : "Any"}`, callback_data: `sigf:score:${n}` })));
  }
  const filt = on ? (hasFilters ? `\n\n<b>You receive:</b> ${esc(filtersLabel(f))}.\nRows below: timeframes, direction, minimum setup score. Follow-ups (TP, stop, cancelled) only come for signals you received.` : "\n\nSignal filters need the latest database update (run supabase/schema.sql once).") : "";
  return tgSend(c.chatId, `${who(c)}<b>📣 Confirmed-trade signals for ${scope}: ${on ? "ON" : "OFF"}</b>\n${on ? `Every time the engine confirms a new trade${c.isGroup ? "" : ` tradeable on ${esc(VENUE_META[c.venue].label)}`}, one message arrives here with the share card, the full copy-trade block and the action buttons.` : "No automatic messages. Commands and alerts still work."}${filt}`, { html: true, keyboard: kb });
}

/** One tap on a filter button: change it, then show the signals screen again. */
async function signalFilter(c: ChatCtx, key: string, val: string) {
  const table = c.isGroup ? "telegram_chats" : "telegram_users";
  const keyCol = c.isGroup ? "chat_id" : "tg_user_id";
  const keyVal = c.isGroup ? c.chatId : c.tgUserId;
  const cur = await c.sb.from(table).select("sig_filters").eq(keyCol, keyVal).maybeSingle();
  if (cur.error) return tgSend(c.chatId, "Signal filters need the latest database update: run supabase/schema.sql once in Supabase, then try again.");
  const f: SignalFilters = cleanFilters(cur.data?.sig_filters);
  if (key === "tf") {
    const all = [...FILTER_TFS] as string[];
    const now = new Set(f.tfs ?? all);
    if (now.has(val)) now.delete(val); else now.add(val);
    if (!now.size) return tgSend(c.chatId, "Keep at least one timeframe on. To stop all signals, use Turn off.");
    f.tfs = all.filter((t) => now.has(t));
  } else if (key === "side") f.longsOnly = val === "long";
  else if (key === "score") f.minScore = Number(val) || 0;
  const clean = cleanFilters(f);
  if (c.isGroup) await c.sb.from("telegram_chats").upsert({ chat_id: c.chatId, sig_filters: clean, updated_at: new Date().toISOString() });
  else await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, user_id: c.userId, venue: c.venue, sig_filters: clean, updated_at: new Date().toISOString() });
  return signals(c, "");
}

/** The week's signals, graded from the ledger: delivered first, then not delivered, then combined. */
async function recap(c: ChatCtx) {
  await tgTyping(c.chatId);
  const r = await safe(buildRecap(c.sb));
  if (!r.ok) return tgSend(c.chatId, `Could not build the recap: ${esc(r.error)}`, { html: true });
  const msgs = r.data.messages;
  for (let i = 0; i < msgs.length; i++) {
    const last = i === msgs.length - 1;
    await tgSend(c.chatId, last ? `${msgs[i]}\nLong-press a block to copy it. The same recap goes out every Sunday evening.` : msgs[i], { html: true, keyboard: last ? [[{ text: "🏆 Track record", callback_data: "record" }, { text: "Menu", callback_data: "menu" }]] : undefined });
  }
}

/** Speculative alerts: off, or one of the fixed presets. Private chats only. */
async function speculative(c: ChatCtx, arg: string) {
  if (c.isGroup) return tgSend(c.chatId, "Speculative alerts are personal: open a private chat with the bot and send /speculative there.");
  const a = arg.trim().toLowerCase();
  const want = (a === "off" || (PRESET_IDS as string[]).includes(a)) ? (a as PresetId | "off") : null;
  if (want) {
    const { error } = await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, user_id: c.userId, venue: c.venue, spec_preset: want, updated_at: new Date().toISOString() });
    if (error) return tgSend(c.chatId, "Speculative alerts need the latest database update: run supabase/schema.sql once in Supabase, then try again.");
  }
  const { data, error } = await c.sb.from("telegram_users").select("spec_preset, broadcast").eq("tg_user_id", c.tgUserId).maybeSingle();
  if (error) return tgSend(c.chatId, "Speculative alerts need the latest database update: run supabase/schema.sql once in Supabase, then try again.");
  const cur = (PRESET_IDS as string[]).includes(data?.spec_preset) ? data!.spec_preset as PresetId : "off";
  const lines = PRESET_IDS.map((id) => { const p = PRESETS[id]; return `<b>${p.label}</b>: ${p.tfs.join(", ")} · R:R ${p.minRr === 0 ? "any" : `${p.minRr}+`} · stop max ${p.maxStopPct === Infinity ? "any" : `${p.maxStopPct}%`} · score ${p.minScore || "any"}+ · ${p.dailyCap === Infinity ? "no" : p.dailyCap} a day`; }).join("\n");
  const note = data?.broadcast === false ? "\n\nYour Confirmed-trade signals are off, so speculative alerts are off too. Turn them on first." : "";
  const kb: Keyboard = [
    [{ text: `${cur === "off" ? "✅" : "⬜"} Off`, callback_data: "spec:off" }],
    PRESET_IDS.map((id) => ({ text: `${cur === id ? "✅" : "⬜"} ${PRESETS[id].label}`, callback_data: `spec:${id}` })),
    [{ text: "Menu", callback_data: "menu" }],
  ];
  return tgSend(c.chatId, `<b>🔍 Speculative alerts: ${cur === "off" ? "OFF" : PRESETS[cur].label}</b>\nEarly setups the engine has not confirmed yet. Off by default. Each preset has fixed limits, and every signal that a preset skips is logged with the reason. Only signals that reach you count in the recap's "delivered" figures.\n\n${lines}${note}`, { html: true, keyboard: kb });
}

/** Squixi's plain-language walk through one trade: the same explanation as the 🦑 button on the website. */
async function explainSetup(c: ChatCtx, id: string, tf: Timeframe) {
  await tgTyping(c.chatId);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const { t, s, sig } = await planFor(c, cn, tf);
  const m = setupBriefing({ symbol: cn.symbol, id: cn.id, tf, price: t?.price ?? null, setup: s, outlook: t?.outlook ?? null, score: t?.score ?? null, venue: c.venue, isSignal: sig?.status === "active" });
  const rows = (m.rows ?? []).map((r) => `<b>${esc(r.k)}:</b> ${esc(r.v)}`).join("\n");
  const notes = (m.notes ?? []).map((n) => `• ${esc(n)}`).join("\n");
  const text = `🦑 <b>${esc(SQUIXI)}</b>\n<b>${esc(m.title)}</b>\n${m.text ? `${esc(m.text)}\n` : ""}${rows ? `\n${rows}\n` : ""}${notes ? `\n${notes}` : ""}`;
  return tgSend(c.chatId, text.slice(0, 3900), { html: true, keyboard: s ? [[{ text: "📐 Size it", callback_data: `size:${s.entry.mid}:${s.stopLosses[0].price}` }, { text: "📋 Copy setup", callback_data: `copy:${ref(cn)}:${tf}` }], [{ text: "🤖 Ask Squixi more", callback_data: "askai" }]] : [[{ text: "🤖 Ask Squixi", callback_data: "askai" }]] });
}

async function settingsSet(c: ChatCtx, key: string, val?: string) {
  if (key === "unlink") return unlink(c);
  if (!c.userId) return needLink(c);
  if (key === "digest") await c.sb.from("profiles").update({ digest_enabled: val === "1" }).eq("id", c.userId);
  if (key === "hour") await c.sb.from("profiles").update({ digest_hour: Math.max(0, Math.min(23, Number(val) || 0)) }).eq("id", c.userId);
  if (key === "plan") await c.sb.from("profiles").update({ plan_enabled: val === "1" }).eq("id", c.userId);
  if (key === "planhour") await c.sb.from("profiles").update({ plan_hour: Math.max(0, Math.min(23, Number(val) || 0)) }).eq("id", c.userId);
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
      const a = await safe(analyzeScreen({ symbol: cn.symbol, coingeckoId: cn.id }, ["4h", "1d"]));
      if (a.ok) for (const tf of ["4h", "1d"] as Timeframe[]) {
        const t = a.data.timeframes[tf]; if (!t || "unavailable" in t) continue;
        const s = t.setup;
        const title = s ? `${cn.symbol} ${s.side} ${tf} · ${s.kind} · score ${s.confidence}/100` : `${cn.symbol} ${tf} · ${t.outlook} · no setup`;
        const body = s ? `<b>${esc(cn.symbol)} ${s.side} ${tf}</b> (${esc(s.kind)}, score ${s.confidence}/100, ${s.riskRewardTp2}R)\nPrice ${fmtUsd(t.price)}\nEntry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}\n${s.takeProfits.slice(0, 3).map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")}\n${s.stopLosses.map((x) => `${x.label} ${fmtUsd(x.price)}`).join(" · ")}\n${esc(a.data.consensus.summary)}\n<i>AsheSignal. Manual trading only. Not financial advice.</i>` : `<b>${esc(cn.symbol)} ${tf}</b>: ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}), RSI ${t.momentum.rsi.toFixed(0)}, price ${fmtUsd(t.price)}.\n${esc(a.data.consensus.summary)}\n<i>AsheSignal. Not financial advice.</i>`;
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

// ---------- plan and record ----------

async function plan(c: ChatCtx) {
  await tgTyping(c.chatId);
  const p = await buildPlan(c.sb, c.userId, c.venue);
  const vm = VENUE_META[c.venue];
  const icon = p.market.verdict === "avoid" ? "🔴" : p.market.verdict === "caution" ? "🟡" : "🟢";
  const lines = [
    `${who(c)}<b>☀️ Today's plan</b> for ${esc(vm.label)}`,
    `${icon} ${esc(p.market.stance)}`,
    `<i>${esc(p.market.headline)}${p.market.regime ? ` Regime ${esc(p.market.regime)}.` : ""}</i>`,
    "",
    "<b>Do today</b>",
    ...p.todo.map((t, i) => `${i + 1}. ${esc(t)}`),
  ];
  if (p.trades.length) { lines.push("", "<b>Your open trades</b>"); for (const t of p.trades) lines.push(`${t.tone === "up" ? "🟢" : t.tone === "down" ? "🔴" : t.tone === "amber" ? "🟡" : "▫️"} <b>${esc(t.symbol)}</b> ${t.side} ${esc(t.timeframe)}${t.paper ? " (paper)" : ""}${t.pnlPct != null ? ` ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct}%` : ""}: ${esc(t.action)}`); }
  if (p.setups.length) { lines.push("", `<b>Confirmed on ${esc(vm.label)}</b>`); for (const sx of p.setups) lines.push(`• <b>${esc(sx.symbol)}</b> ${sx.side} ${esc(sx.timeframe)} conf ${sx.confidence}%${sx.entry ? ` · entry ${fmtUsd(sx.entry.low)} to ${fmtUsd(sx.entry.high)}` : ""}${sx.stop ? ` · SL ${fmtUsd(sx.stop)}` : ""} · ${sx.zone.state === "in" ? "🟢 in zone" : esc(sx.zone.label)}`); }
  if (p.watching.length && !p.setups.length) { lines.push("", "<b>Closest to confirming</b>"); for (const sx of p.watching) lines.push(`• ${esc(sx.symbol)} ${sx.side} ${esc(sx.timeframe)}${sx.why ? `: ${esc(sx.why)}` : ""}`); }
  if (p.heat) lines.push("", `<b>Risk budget</b>: heat ${p.heat.heatPct ?? "?"}% of ${p.heat.maxHeatPct}%, ${p.heat.openCount}/${p.heat.maxOpen} trades open${p.heat.budgetUsd != null ? `, ${fmtUsd(p.heat.budgetUsd)} left to risk` : ""}.`);
  if (p.events.length) lines.push("", `<b>Events</b>: ${p.events.map((e) => `${esc(e.title)} ${new Date(e.time).toUTCString().slice(17, 22)} UTC`).join("; ")}`);
  const kb: Keyboard = [];
  if (p.setups.length) kb.push(p.setups.map((sx) => ({ text: `${sx.symbol} card`, callback_data: `setup:${ref({ id: sx.coingeckoId, symbol: sx.symbol })}:${sx.timeframe}` })));
  kb.push([{ text: "My trades", callback_data: "me" }, { text: "Confirmed", callback_data: "cat:confirmed" }, { text: "Menu", callback_data: "menu" }]);
  if (link("/")) kb.push([{ text: "Open the plan page", url: link("/plan")! }]);
  const out = lines.join("\n");
  return tgSend(c.chatId, out.length > 4000 ? out.slice(0, 3990) + "…" : out, { html: true, keyboard: kb });
}

async function record(c: ChatCtx) {
  await tgTyping(c.chatId);
  const r = await buildTrackRecord(c.sb, c.userId);
  const t = r.signals.total;
  const b = (x: { key: string; n: number; winRate: number | null; avgR: number | null; sumR: number }) => `${esc(x.key)}: ${x.n} · ${x.winRate != null ? `${x.winRate}% win` : "no result yet"} · ${x.avgR != null ? `${x.avgR > 0 ? "+" : ""}${x.avgR}R avg` : ""} · ${x.sumR > 0 ? "+" : ""}${x.sumR}R total`;
  const lines = [
    `${who(c)}<b>📈 Engine track record</b>${r.since ? ` since ${r.since.slice(0, 10)}` : ""}`,
    `${t.n} signals, ${t.resolved} resolved: <b>${t.winRate != null ? `${t.winRate}% win rate` : "no results yet"}</b>, avg ${t.avgR != null ? `${t.avgR > 0 ? "+" : ""}${t.avgR}R` : "-"}, total <b>${t.sumR > 0 ? "+" : ""}${t.sumR}R</b>`,
    `(${t.wins} wins, ${t.losses} stops, ${t.expired} expired. A stop is -1R; targets count their distance over the stop distance.)`,
    "",
    "<b>By kind</b>", ...r.signals.byKind.map(b),
    "", "<b>By timeframe</b>", ...r.signals.byTimeframe.map(b),
    "", `<b>Broadcast confirmed trades</b>: ${r.followups.total} sent, ${r.followups.open} open, TP1 ${r.followups.tp1}, TP2 ${r.followups.tp2}, stopped ${r.followups.sl}, lost before TP1 ${r.followups.lost}${r.followups.tp1Rate != null ? ` (TP1 rate ${r.followups.tp1Rate}% of closed)` : ""}`,
  ];
  if (r.journal) lines.push("", `<b>Your record</b>: ${r.journal.total.n} taken, ${r.journal.total.resolved} closed, ${r.journal.total.winRate != null ? `${r.journal.total.winRate}% win` : "no closed yet"}, real ${r.journal.real.sumR > 0 ? "+" : ""}${r.journal.real.sumR}R, paper ${r.journal.paper.sumR > 0 ? "+" : ""}${r.journal.paper.sumR}R`);
  lines.push("", "<i>Nobody can edit these rows; the worker writes them from price outcomes.</i>");
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[...(link("/") ? [{ text: "Full track record", url: link("/track-record")! }] : []), { text: "Menu", callback_data: "menu" }]] });
}

// ---------- simulator, compare, events, heat ----------

async function simulateCmd(c: ChatCtx, arg: string) {
  await tgTyping(c.chatId);
  const nums = arg.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  let balance = nums[0], risk = nums[1];
  if (!balance && c.userId) { const { data: p } = await c.sb.from("profiles").select("trading_balance, risk_pct").eq("id", c.userId).maybeSingle(); balance = Number(p?.trading_balance) || 0; risk = risk || Number(p?.risk_pct) || 1; }
  balance = balance || SIM_DEFAULTS.balance; risk = Math.min(10, risk || SIM_DEFAULTS.riskPct);
  const r = await simulate(c.sb, { ...SIM_DEFAULTS, balance, riskPct: risk, venue: c.venue });
  const vm = VENUE_META[c.venue];
  const text = [
    `${who(c)}<b>🧮 Simulator</b>: every confirmed signal tradeable on ${esc(vm.label)}, last ${SIM_DEFAULTS.sinceDays} days, ${risk}% risk, max ${SIM_DEFAULTS.maxOpen} open`,
    r.trades ? `${fmtUsd(balance)} → <b>${fmtUsd(r.endBalance)}</b> (${r.returnPct >= 0 ? "+" : ""}${r.returnPct}%)` : "",
    r.trades ? `${r.trades} trades: ${r.wins} wins, ${r.losses} stops, ${r.expired} expired · avg ${r.avgR > 0 ? "+" : ""}${r.avgR}R · total ${r.totalR > 0 ? "+" : ""}${r.totalR}R` : "",
    r.trades ? `Max drawdown ${r.maxDrawdownPct}% · profit factor ${r.profitFactor == null ? "∞" : r.profitFactor} · best streak ${r.bestStreak}, worst ${r.worstStreak}` : "",
    r.monthly.length ? `\n<b>By month</b>\n${r.monthly.slice(-6).map((m) => `${m.key}: ${m.trades} trades, ${m.r > 0 ? "+" : ""}${m.r}R`).join("\n")}` : "",
    `\n<i>${esc(r.note)}</i>`,
    "Usage: /simulate 1000 1 (balance, risk %).",
  ].filter(Boolean).join("\n");
  return tgSend(c.chatId, text, { html: true, keyboard: [[...(link("/") ? [{ text: "Simulator page", url: link(`/simulator`)! }] : []), { text: "Track record", callback_data: "record" }, { text: "Menu", callback_data: "menu" }]] });
}

async function compare(c: ChatCtx, arg: string) {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return tgSend(c.chatId, "Compare two coins: /compare BTC ETH [4h]");
  const tf = (["1h", "4h", "1d"].includes(parts[2]) ? parts[2] : "4h") as Timeframe;
  await tgTyping(c.chatId);
  const [a, b] = await Promise.all([resolveCoin(parts[0]), resolveCoin(parts[1])]);
  if (!a || !b) return tgSend(c.chatId, `Could not find ${!a ? esc(parts[0]) : esc(parts[1])}.`, { html: true });
  const [ra, rb] = await Promise.all([safe(analyzeScreen({ symbol: a.symbol, coingeckoId: a.id }, [tf])), safe(analyzeScreen({ symbol: b.symbol, coingeckoId: b.id }, [tf]))]);
  const row = (cn: { symbol: string }, r: typeof ra) => {
    const t = r.ok ? r.data.timeframes[tf] : null; if (!t || "unavailable" in t) return `<b>${esc(cn.symbol)}</b>: no data`;
    const s = t.setup; const z = s ? zoneStatus(t.price, s.entry, s.side) : null;
    return `<b>${esc(cn.symbol)}</b> ${fmtUsd(t.price)}\n  ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}) · trend ${esc(t.trend.direction)} · RSI ${t.momentum.rsi.toFixed(0)} · vol ${t.volume.ratio.toFixed(2)}x\n  ${s ? `${s.side} ${esc(s.kind)} · score ${s.confidence}/100 · ${s.riskRewardTp2}R · ${z && z.state !== "unknown" ? esc(z.label) : ""}` : "no setup"}`;
  };
  const pick = (() => { const ta = ra.ok ? ra.data.timeframes[tf] : null, tb = rb.ok ? rb.data.timeframes[tf] : null; const sa = ta && !("unavailable" in ta) ? ta.setup : null, sb2 = tb && !("unavailable" in tb) ? tb.setup : null; const score = (s: any) => (s ? (s.kind === "confirmed" ? 100 : s.kind === "speculative" ? 20 : 50) + s.confidence : 0); const qa = score(sa), qb = score(sb2); if (!qa && !qb) return "Neither has a setup right now."; return qa === qb ? "Equal on paper; pick the one in its entry zone." : `Cleaner setup right now: <b>${esc(qa > qb ? a.symbol : b.symbol)}</b>.`; })();
  return tgSend(c.chatId, `${who(c)}<b>⚖️ ${esc(a.symbol)} vs ${esc(b.symbol)}</b> (${tf})\n\n${row(a, ra)}\n\n${row(b, rb)}\n\n${pick}`, { html: true, keyboard: [[{ text: `${a.symbol} card`, callback_data: `setup:${ref(a)}:${tf}` }, { text: `${b.symbol} card`, callback_data: `setup:${ref(b)}:${tf}` }], [{ text: "Menu", callback_data: "menu" }]] });
}

async function events(c: ChatCtx) {
  await tgTyping(c.chatId);
  const r = await safe(conditionsForEvents());
  if (!r.ok) return tgSend(c.chatId, "Calendar unavailable right now.");
  const now = Date.now();
  const ev = (r.data.events as any[]).filter((e) => Date.parse(e.time) > now - 3_600_000).sort((x, y) => Date.parse(x.time) - Date.parse(y.time)).slice(0, 10);
  if (!ev.length) return tgSend(c.chatId, "No upcoming calendar events loaded.");
  const lines = ev.map((e) => { const d = new Date(e.time); const inH = (d.getTime() - now) / 3_600_000; return `${e.impact === "High" ? "🔴" : e.impact === "Medium" ? "🟡" : "⚪"} <b>${esc(e.title)}</b> · ${d.toUTCString().slice(0, 22)} UTC${inH < 24 ? ` (in ${inH < 1 ? `${Math.max(0, Math.round(inH * 60))} min` : `${inH.toFixed(1)} h`})` : ""}`; });
  return tgSend(c.chatId, `${who(c)}<b>📆 Upcoming events</b>\n${lines.join("\n")}\n\n<i>Rule of thumb: no new entries in the 30 minutes around a red event; stops get hunted.</i>`, { html: true, keyboard: [[{ text: "Today", callback_data: "today" }, { text: "Plan", callback_data: "plan" }, { text: "Menu", callback_data: "menu" }]] });
}

async function heat(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  const [{ data: open }, { data: prof }] = await Promise.all([
    c.sb.from("saved_setups").select("symbol, side, timeframe, risk_usd, paper").eq("user_id", c.userId).eq("taken", true).eq("paper", false).is("exit_price", null),
    c.sb.from("profiles").select("trading_balance, preferences").eq("id", c.userId).maybeSingle(),
  ]);
  const limits = { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) };
  const bal = prof?.trading_balance ? Number(prof.trading_balance) : null;
  const h = portfolioHeat((open ?? []).map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd) })), bal, limits);
  const budget = bal != null && h.heatPct != null ? Math.max(0, ((limits.maxHeatPct - h.heatPct) / 100) * bal) : null;
  return tgSend(c.chatId, `${who(c)}<b>🌡 Portfolio heat</b>\n${h.level === "stop" ? "🔴" : h.level === "caution" ? "🟡" : "🟢"} ${h.heatPct != null ? `${h.heatPct}% of your account at risk` : "Set your balance on the Risk page to measure heat"} (limit ${limits.maxHeatPct}%)\n${(open ?? []).length}/${limits.maxOpen} real trades open${budget != null ? ` · ${fmtUsd(budget)} left to risk today` : ""}\n${(open ?? []).map((t) => `- ${esc(t.symbol)} ${t.side} ${esc(t.timeframe)}${t.risk_usd ? `: ${fmtUsd(Number(t.risk_usd))}` : ": size unknown"}`).join("\n")}\n${esc(h.messages[0] ?? "")}`, { html: true, keyboard: [[{ text: "My trades", callback_data: "me" }, { text: "Plan", callback_data: "plan" }]] });
}

// ---------- stage 37-40: radar, DCA, movers, academy ----------

async function radar(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const r = await buildRadar(c.sb, c.userId, c.venue);
  if (r.note) return tgSend(c.chatId, `${who(c)}<b>📡 Holdings radar</b>\n${esc(r.note)}`, { html: true, keyboard: [[...(link("/") ? [{ text: "Portfolio", url: link("/portfolio")! }] : []), { text: "Menu", callback_data: "menu" }]] });
  const icon = (t: string) => (t === "down" ? "🔴" : t === "up" ? "🟢" : t === "amber" ? "🟡" : "▫️");
  const lines = r.rows.slice(0, 12).map((x) => `${icon(x.tone)} <b>${esc(x.symbol)}</b> ${fmtUsd(x.valueUsd)} (${x.pct.toFixed(0)}%)\n   ${esc(x.action)}${x.flags.length ? `\n   ⚠ ${esc(x.flags[0])}` : ""}`);
  const kb: Keyboard = [];
  const tappable = r.rows.filter((x) => x.coingeckoId).slice(0, 6);
  for (let k = 0; k < tappable.length; k += 2) kb.push(tappable.slice(k, k + 2).map((x) => ({ text: `${x.symbol} card`, callback_data: `setup:${ref({ id: x.coingeckoId!, symbol: x.symbol })}:4h` })));
  kb.push([...(link("/") ? [{ text: "🌐 Full radar", url: link("/radar")! }] : []), { text: "Menu", callback_data: "menu" }]);
  const out = `${who(c)}<b>📡 Holdings radar</b> · ${fmtUsd(r.totalUsd)}\n${esc(r.summary)}\n\n${lines.join("\n\n")}${r.unscreened.length ? `\n\n<i>Not screened: ${esc(r.unscreened.map((u) => u.symbol).join(", "))}</i>` : ""}`;
  return tgSend(c.chatId, out.length > 4000 ? out.slice(0, 3990) + "…" : out, { html: true, keyboard: kb });
}

async function dcaCmd(c: ChatCtx, arg: string) {
  const parts = arg.trim().split(/\s+/);
  const cn = await resolveCoin(parts[0] ?? ""); if (!cn) return tgSend(c.chatId, "Which coin? Example: /dca BTC 200");
  const budget = Math.max(5, Number(String(parts[1] ?? "").replace(/[$,]/g, "")) || 200);
  const count = Number(parts[2]) || 4;
  await tgTyping(c.chatId);
  const z = await resolveZone(c.sb, cn);
  if (!z) return tgSend(c.chatId, `No price data for ${esc(cn.symbol)} right now.`, { html: true });
  const p = planLadder({ symbol: cn.symbol, price: z.price, zone: z.zone, budget, count, weighting: "even", zoneSource: z.source, takeProfit: z.takeProfit });
  const lines = p.orders.map((o, i) => `${o.n}. Limit buy <b>${fmtUsd(o.price)}</b> · ${fmtUsd(o.usd)} · ${fmtNum(o.units, 6)} ${esc(cn.symbol)} · avg so far ${fmtUsd(p.partial[i].avg)}`);
  const text = [
    `${who(c)}<b>🪜 DCA plan: ${esc(cn.symbol)}</b>, ${fmtUsd(budget)} in ${p.orders.length} orders`,
    `Now ${fmtUsd(p.price)} · zone ${fmtUsd(p.zone.low)} to ${fmtUsd(p.zone.high)} (${esc(p.zoneSource)})`,
    "", ...lines, "",
    `Average if all fill: <b>${fmtUsd(p.avgIfAll)}</b> (${fmtNum(p.unitsIfAll, 6)} ${esc(cn.symbol)})`,
    `Review level: <b>${fmtUsd(p.reviewLevel)}</b>. ${esc(p.reviewNote)}`,
    p.takeProfit.length ? `Take profit later: ${p.takeProfit.map((t) => `${esc(t.label)} ${fmtUsd(t.price)}`).join(" · ")}` : "",
    "", ...p.notes.slice(0, 2).map((n) => `• ${esc(n)}`),
  ].filter((x) => x !== null).join("\n");
  return tgSend(c.chatId, text, { html: true, keyboard: [[{ text: `📊 ${cn.symbol} card`, callback_data: `setup:${ref(cn)}:1d` }, ...(link("/") ? [{ text: "🌐 Planner", url: link(`/dca?symbol=${cn.symbol}&budget=${budget}`)! }] : [])], [{ text: "Menu", callback_data: "menu" }]] });
}

async function movers(c: ChatCtx) {
  await tgTyping(c.chatId);
  const m = await buildMovers(c.sb, c.venue, { limit: 5 });
  const pct = (v: number | null) => `${(v ?? 0) >= 0 ? "+" : ""}${(v ?? 0).toFixed(1)}%`;
  const row = (r: { symbol: string; price: number | null; change24h: number | null; listed: boolean }) => `<b>${esc(r.symbol)}</b> ${pct(r.change24h)} · ${fmtUsd(r.price)}${r.listed ? " ✓" : ""}`;
  const text = [
    `${who(c)}<b>🚀 Market movers</b> (24h, over 50M cap)${m.breadth ? ` · ${m.breadth.up} up / ${m.breadth.down} down` : ""}`,
    "", "<b>Gainers</b>", ...m.gainers.map(row),
    "", "<b>Losers</b>", ...m.losers.map(row),
    m.volume.length ? `\n<b>Volume spikes (4h)</b>\n${m.volume.slice(0, 4).map((v) => `${esc(v.symbol)} ${v.ratio}x · ${esc(v.outlook ?? "")}`).join("\n")}` : "",
    m.confirmedNew.length ? `\n<b>Newly confirmed</b>\n${m.confirmedNew.slice(0, 5).map((x) => `✅ ${esc(x.symbol)} ${x.side ?? ""} ${esc(x.timeframe)}${x.listed ? " ✓" : ""}`).join("\n")}` : "",
    m.confirmedLost.length ? `\n<b>Lost confirmation</b>\n${m.confirmedLost.slice(0, 4).map((x) => `⚠️ ${esc(x.symbol)} ${esc(x.timeframe)}`).join("\n")}` : "",
    `\n<i>✓ = listed on ${esc(VENUE_META[c.venue].label)}. A big move is information, not a signal.</i>`,
  ].filter(Boolean).join("\n");
  const tap = [...m.gainers.slice(0, 2), ...m.losers.slice(0, 2)];
  return tgSend(c.chatId, text, { html: true, keyboard: [tap.slice(0, 2).map((r) => ({ text: `${r.symbol} card`, callback_data: `setup:${ref({ id: r.id, symbol: r.symbol })}:4h` })), tap.slice(2, 4).map((r) => ({ text: `${r.symbol} card`, callback_data: `setup:${ref({ id: r.id, symbol: r.symbol })}:4h` })), [...(link("/") ? [{ text: "🌐 Movers page", url: link("/movers")! }] : []), { text: "Menu", callback_data: "menu" }]].filter((r) => r.length) });
}

async function learnDone(c: ChatCtx): Promise<string[]> {
  const { data } = await c.sb.from("telegram_users").select("learn").eq("tg_user_id", c.tgUserId).maybeSingle();
  return Array.isArray(data?.learn?.done) ? data!.learn.done : [];
}
async function learnList(c: ChatCtx) {
  const done = await learnDone(c);
  const kb: Keyboard = [];
  for (let i = 0; i < LESSONS.length; i += 2) kb.push(LESSONS.slice(i, i + 2).map((l, j) => ({ text: `${done.includes(l.id) ? "✅" : l.emoji} ${l.short}`, callback_data: `lesson:${i + j}` })));
  kb.push([...(link("/") ? [{ text: "🌐 Academy", url: link("/learn")! }] : []), { text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, `${who(c)}<b>🎓 Academy</b>: ${LESSONS.length} short lessons with a quiz each. ${done.length}/${LESSONS.length} done.\nPick one:`, { html: true, keyboard: kb });
}
async function lessonShow(c: ChatCtx, i: number) {
  const l = LESSONS[i]; if (!l) return learnList(c);
  const text = `<b>${l.emoji} ${esc(l.title)}</b> · ${l.minutes} min\n<i>${esc(l.summary)}</i>\n\n${l.body.map(esc).join("\n\n")}\n\n<b>Remember</b>\n${l.keyPoints.map((k) => `• ${esc(k)}`).join("\n")}`;
  return tgSend(c.chatId, text, { html: true, keyboard: [[{ text: `📝 Quiz (${l.quiz.length} questions)`, callback_data: `lq:${i}:0` }], [{ text: "📚 All lessons", callback_data: "learn" }, ...(LESSONS[i + 1] ? [{ text: "Next lesson ▶", callback_data: `lesson:${i + 1}` }] : [])]] });
}
async function quizAsk(c: ChatCtx, i: number, qi: number) {
  const l = LESSONS[i]; const q = l?.quiz[qi]; if (!q) return learnList(c);
  return tgSend(c.chatId, `<b>${l.emoji} ${esc(l.title)}</b> · question ${qi + 1}/${l.quiz.length}\n\n${esc(q.q)}\n\n${q.options.map((o, oi) => `<b>${"ABC"[oi]}</b>. ${esc(o)}`).join("\n")}`, { html: true, keyboard: [q.options.map((_, oi) => ({ text: "ABC"[oi], callback_data: `la:${i}:${qi}:${oi}` }))] });
}
async function quizAnswer(c: ChatCtx, i: number, qi: number, oi: number) {
  const l = LESSONS[i]; const q = l?.quiz[qi]; if (!q) return learnList(c);
  const ok = oi === q.answer;
  const last = qi === l.quiz.length - 1;
  if (last) {
    const done = new Set(await learnDone(c)); done.add(l.id);
    await c.sb.from("telegram_users").update({ learn: { done: [...done] } }).eq("tg_user_id", c.tgUserId).then(() => {}, () => {});
  }
  const kb: Keyboard = last ? [[...(LESSONS[i + 1] ? [{ text: `Next: ${LESSONS[i + 1].short}`, callback_data: `lesson:${i + 1}` }] : []), { text: "📚 All lessons", callback_data: "learn" }]] : [[{ text: "Next question ▶", callback_data: `lq:${i}:${qi + 1}` }]];
  return tgSend(c.chatId, `${ok ? "✅ Correct." : `❌ Not quite. The answer: <b>${esc(q.options[q.answer])}</b>.`}\n${esc(q.why)}${last ? `\n\n🎓 Lesson "${esc(l.title)}" done.` : ""}`, { html: true, keyboard: kb });
}

// ---------- groups: leaderboard and shared watchlist ----------

export async function touchGroupMember(sb: SupabaseClient, chatId: string, tgUserId: string, firstName?: string) {
  await sb.from("telegram_group_members").upsert({ chat_id: chatId, tg_user_id: tgUserId, first_name: firstName ?? null, updated_at: new Date().toISOString() }, { onConflict: "chat_id,tg_user_id", ignoreDuplicates: false }).then(() => {}, () => {});
}
async function optIn(c: ChatCtx, on: boolean) {
  if (!c.isGroup) return tgSend(c.chatId, "The leaderboard lives in groups. In a group, send /optin to appear on it.");
  if (!c.userId && on) return tgSend(c.chatId, `${who(c)}Link your account first (/link CODE in a private chat with me), then /optin here.`, { html: true });
  await c.sb.from("telegram_group_members").upsert({ chat_id: c.chatId, tg_user_id: c.tgUserId, first_name: c.firstName ?? null, opt_in: on, updated_at: new Date().toISOString() }, { onConflict: "chat_id,tg_user_id" });
  return tgSend(c.chatId, `${who(c)}${on ? "You are on this group's leaderboard. Only weekly R and trade counts are shown, never dollar amounts." : "Removed from the leaderboard."}`, { html: true, keyboard: [[{ text: "Leaderboard", callback_data: "leaderboard" }]] });
}
async function leaderboard(c: ChatCtx) {
  if (!c.isGroup) return tgSend(c.chatId, "The leaderboard is a group feature. Add me to a group and send /leaderboard there.");
  await tgTyping(c.chatId);
  const { data: members } = await c.sb.from("telegram_group_members").select("tg_user_id, first_name").eq("chat_id", c.chatId).eq("opt_in", true);
  if (!members?.length) return tgSend(c.chatId, `${who(c)}Nobody has opted in yet. Each member sends /optin (after linking their account) to appear. Shown: trades this week and R, never money.`, { html: true });
  const { data: users } = await c.sb.from("telegram_users").select("tg_user_id, user_id").in("tg_user_id", members.map((m) => m.tg_user_id));
  const monday = new Date(); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const ids = (users ?? []).map((u) => u.user_id).filter(Boolean) as string[];
  const { data: trades } = ids.length ? await c.sb.from("saved_setups").select("user_id, realized_r, paper, exit_at, taken_at").in("user_id", ids).eq("taken", true).or(`exit_at.gte.${monday.toISOString()},taken_at.gte.${monday.toISOString()}`) : { data: [] as any[] };
  const rows = members.map((m) => {
    const uid = (users ?? []).find((u) => u.tg_user_id === m.tg_user_id)?.user_id;
    const mine = (trades ?? []).filter((t) => t.user_id === uid);
    const closed = mine.filter((t) => t.realized_r != null && t.exit_at && Date.parse(t.exit_at) >= monday.getTime());
    const real = closed.filter((t) => !t.paper), paper = closed.filter((t) => t.paper);
    const sum = (xs: any[]) => Math.round(xs.reduce((s, t) => s + Number(t.realized_r), 0) * 100) / 100;
    return { name: m.first_name ?? "member", taken: mine.filter((t) => t.taken_at && Date.parse(t.taken_at) >= monday.getTime()).length, realR: sum(real), realN: real.length, paperR: sum(paper), paperN: paper.length, wins: closed.filter((t) => Number(t.realized_r) > 0).length, closed: closed.length };
  }).sort((a, b) => b.realR + b.paperR * 0.001 - (a.realR + a.paperR * 0.001));
  const medal = ["🥇", "🥈", "🥉"];
  const lines = rows.map((r, i) => `${medal[i] ?? "•"} <b>${esc(r.name)}</b>: ${r.realN ? `${r.realR > 0 ? "+" : ""}${r.realR}R real (${r.realN})` : "no real closes"}${r.paperN ? ` · ${r.paperR > 0 ? "+" : ""}${r.paperR}R paper (${r.paperN})` : ""}${r.closed ? ` · ${Math.round((100 * r.wins) / r.closed)}% win` : ""} · ${r.taken} taken this week`);
  return tgSend(c.chatId, `<b>🏅 Leaderboard, week of ${monday.toISOString().slice(0, 10)}</b>\n${lines.join("\n")}\n\n<i>R only, never dollars. Real and paper shown separately. /optin to join, /optout to leave.</i>`, { html: true, keyboard: [[{ text: "Refresh", callback_data: "leaderboard" }, { text: "Confirmed", callback_data: "cat:confirmed" }]] });
}
async function groupWatchAdd(c: ChatCtx, arg: string) {
  const cn = await resolveCoin(arg.split(/\s+/)[0] ?? ""); if (!cn) return tgSend(c.chatId, "Which coin? /watch SOL");
  await c.sb.from("telegram_group_watch").upsert({ chat_id: c.chatId, coingecko_id: cn.id, symbol: cn.symbol, added_by: c.firstName ?? c.tgUserId }, { onConflict: "chat_id,coingecko_id" });
  return tgSend(c.chatId, `${who(c)}⭐ ${esc(cn.symbol)} added to the group watchlist.`, { html: true, keyboard: [[{ text: "Group watchlist", callback_data: "watchlist" }, { text: `${cn.symbol} card`, callback_data: `setup:${ref(cn)}:4h` }]] });
}
async function groupWatchRemove(c: ChatCtx, arg: string) {
  const cn = await resolveCoin(arg.split(/\s+/)[0] ?? ""); if (!cn) return tgSend(c.chatId, "Which coin? /unwatch SOL");
  await c.sb.from("telegram_group_watch").delete().eq("chat_id", c.chatId).eq("coingecko_id", cn.id);
  return tgSend(c.chatId, `${who(c)}${esc(cn.symbol)} removed from the group watchlist.`, { html: true });
}
async function groupWatchlist(c: ChatCtx) {
  await tgTyping(c.chatId);
  const { data } = await c.sb.from("telegram_group_watch").select("coingecko_id, symbol, added_by").eq("chat_id", c.chatId).order("created_at", { ascending: false }).limit(20);
  if (!data?.length) return tgSend(c.chatId, "The group watchlist is empty. Anyone can add with /watch SOL.");
  const ids = data.map((d) => d.coingecko_id as string);
  const [{ data: rows }, mk] = await Promise.all([
    c.sb.from("coin_metrics").select("asset_key, timeframe, category, price, detail").in("asset_key", ids.map((i) => `cg:${i}`)).in("timeframe", ["4h", "1d"]),
    safe(getMarketsByIds(ids)),
  ]);
  const px = new Map<string, { price: number | null; chg: number | null }>(); if (mk.ok) for (const m of mk.data) px.set(m.id, { price: m.priceUsd, chg: m.change24hPct ?? null });
  const lines = data.map((d) => {
    const mine = (rows ?? []).filter((r) => r.asset_key === `cg:${d.coingecko_id}`);
    const best = mine.find((r) => r.category === "confirmed") ?? mine.find((r) => r.category === "watching") ?? mine[0];
    const p = px.get(d.coingecko_id as string);
    const st = best?.detail?.setup; const z = st && p?.price ? zoneStatus(p.price, st.entry, st.side) : null;
    return `<b>${esc(d.symbol)}</b>${p?.price ? ` ${fmtUsd(p.price)}` : ""}${p?.chg != null ? ` (${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%)` : ""}${best?.category === "confirmed" || best?.category === "watching" ? ` · ${best.category === "confirmed" ? "✅" : "👀"} ${esc(best.category)} ${st?.side ?? ""} ${esc(best.timeframe)}${z && z.state !== "unknown" ? ` · ${z.state === "in" ? "in zone" : esc(z.label)}` : ""}` : " · no setup"}${d.added_by ? ` · <i>${esc(d.added_by)}</i>` : ""}`;
  });
  const kb: Keyboard = [];
  for (let k = 0; k < Math.min(data.length, 9); k += 3) kb.push(data.slice(k, k + 3).map((d) => ({ text: d.symbol, callback_data: `setup:${ref({ id: String(d.coingecko_id), symbol: d.symbol })}:4h` })));
  return tgSend(c.chatId, `<b>⭐ Group watchlist</b> (${data.length})\n${lines.join("\n")}\n\n/watch SYM adds, /unwatch SYM removes. /mywatch SYM adds to your personal list instead.`, { html: true, keyboard: kb });
}

// ---------- free text ----------

async function freeText(c: ChatCtx, text: string) {
  // Replying to one of the bot's messages is always conversation, even when the reply is a single word.
  if (!c.quoted) {
    // A contract address on any chain opens the scanner card.
    const addr = text.trim().split(/\s+/)[0];
    if (addr && classifyAddress(addr) !== "unknown") return scanCard(c, addr);
    // A bare ticker ("SOL", "$btc", "link 1d") opens the coin card directly.
    // Only an explicit ticker opens a card: written in CAPITALS ("SOL", "BTC 1d") or with a $ ("$sol").
    const m = text.trim().match(/^(\$?)([A-Za-z0-9]{2,10})(?:\s+(1h|4h|1d))?$/);
    const explicit = m && (m[1] === "$" || (m[2] === m[2].toUpperCase() && /[A-Z]/.test(m[2])));
    if (m && explicit && !/^(OK|YES|NO|HI|HELP|MENU)$/.test(m[2].toUpperCase())) {
      const cn = await resolveCoin(m[2]);
      if (cn && cn.symbol.toUpperCase() === m[2].toUpperCase()) return setupCard(c, cn.id, (m[3] as Timeframe) || null, cn);
    }
  }
  return aiChat(c, text);
}

// ---------- AI chat: a real conversation, per person, with memory and reply context ----------

interface AiTurn { role: "user" | "assistant"; text: string }
interface AiMemory { turns: AiTurn[]; coin?: { id: string; symbol: string; name: string } | null; at: number }
const AI_TTL_MS = 3 * 3_600_000;

async function loadMemory(c: ChatCtx): Promise<AiMemory> {
  const { data } = await c.sb.from("telegram_users").select("ai_chat").eq("tg_user_id", c.tgUserId).maybeSingle();
  const m = data?.ai_chat as AiMemory | null;
  return m && Date.now() - (m.at ?? 0) < AI_TTL_MS ? { turns: m.turns ?? [], coin: m.coin ?? null, at: m.at } : { turns: [], coin: null, at: Date.now() };
}
async function saveMemory(c: ChatCtx, m: AiMemory) {
  await c.sb.from("telegram_users").update({ ai_chat: { turns: m.turns.slice(-10), coin: m.coin ?? null, at: Date.now() } }).eq("tg_user_id", c.tgUserId).then(() => {}, () => {});
}
async function aiReset(c: ChatCtx) {
  await c.sb.from("telegram_users").update({ ai_chat: null }).eq("tg_user_id", c.tgUserId).then(() => {}, () => {});
  return tgSend(c.chatId, `${who(c)}🧹 Fresh conversation. Ask me anything about the market.`, { html: true, keyboard: [[{ text: "Menu", callback_data: "menu" }]] });
}
async function askAiPrompt(c: ChatCtx) {
  const examples = ["Is BTC still bullish on the 4h?", "What can I trade today on my exchange?", "Why is SOL only watching and not confirmed?", "Explain a stop-limit order like I'm new", "How are my trades doing?"];
  return tgSend(c.chatId, `${who(c)}<b>🦑 Ask ${esc(SQUIXI)} anything</b> about the crypto market, a coin, your trades or how to trade.\n${c.isGroup ? "In a group, <b>reply to this message</b> (or mention me) with your question." : "Just type your question."} You can also reply to any card or signal I send to ask about it, and keep replying to my answers to continue the conversation.\n\nTry:\n${examples.map((e) => `• ${esc(e)}`).join("\n")}`, { html: true, keyboard: [[{ text: "🧹 New chat", callback_data: "newchat" }, { text: "Menu", callback_data: "menu" }]] });
}

async function aiChat(c: ChatCtx, text: string) {
  await tgTyping(c.chatId);
  const mem = await loadMemory(c);
  try {
    const a = await answer({ question: text, venue: c.venue, userId: c.userId, sb: c.userId ? c.sb : null, adminSb: c.sb, history: mem.turns, quoted: c.quoted ?? null, lastCoin: mem.coin ?? null });
    const cc = a.context?.coin as any;
    const coinNow = cc?.id ? { id: String(cc.id), symbol: String(cc.symbol), name: String(cc.name ?? cc.symbol) } : null;
    await saveMemory(c, { turns: [...mem.turns, { role: "user", text: text.slice(0, 600) }, { role: "assistant", text: [a.text, ...(a.bullets ?? [])].join(" ").slice(0, 900) }], coin: coinNow ?? mem.coin ?? null, at: Date.now() });
    // Tickers in bold so the coin being discussed stands out.
    const boldTickers = (t: string) => esc(t).replace(/\b([A-Z][A-Z0-9]{1,9})\b/g, (w) => (coinNow && w === coinNow.symbol) || /^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LINK|AVAX|TON|SUI|PEPE|DOT|LTC|TRX|USDC|USDT)$/.test(w) ? `<b>${w}</b>` : w);
    const body = [boldTickers(a.text), ...(a.bullets?.length ? ["", ...a.bullets.map((b) => `• ${boldTickers(b)}`)] : [])].join("\n");
    // Buttons that match what was asked, so the answer leads straight to the card or section it talks about.
    const kb: Keyboard = [];
    if (coinNow) kb.push([{ text: `📊 ${coinNow.symbol} card`, callback_data: `setup:${ref(coinNow)}:4h` }, { text: `⭐ Watch ${coinNow.symbol}`, callback_data: `watch:${ref(coinNow)}` }]);
    const byIntent: Record<string, Keyboard[number]> = {
      trades_for_me: [{ text: "✅ Confirmed", callback_data: "cat:confirmed" }, { text: "☀️ Plan", callback_data: "plan" }],
      today: [{ text: "🌡 Market today", callback_data: "today" }, { text: "☀️ Plan", callback_data: "plan" }],
      regime: [{ text: "🌡 Market today", callback_data: "today" }, { text: "☀️ Plan", callback_data: "plan" }],
      my_trades: [{ text: "👤 My trades", callback_data: "me" }, { text: "📅 Week review", callback_data: "review" }],
      risk: [{ text: "📐 Size a trade", callback_data: "ask:size" }, { text: "🌡 My risk", callback_data: "heat" }],
      spot: [{ text: "🏦 Spot picks", callback_data: "cat:spot" }],
      howto: [{ text: "📖 Trade guide", callback_data: "guide" }],
    };
    if (byIntent[a.intent]) kb.push(byIntent[a.intent]);
    kb.push([{ text: "🧹 New chat", callback_data: "newchat" }, { text: "Menu", callback_data: "menu" }]);
    const foot = `\n\n<i>${c.isGroup ? "Reply to this message to keep talking." : "Keep typing, or reply to this message, to continue."} Not financial advice.</i>`;
    return tgSend(c.chatId, body + foot, { html: true, keyboard: kb, replyTo: c.isGroup && !c.fromButton ? c.messageId : undefined });
  } catch (e) {
    return tgSend(c.chatId, `Could not answer right now: ${esc((e as Error).message)}`, { html: true });
  }
}
