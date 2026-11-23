/* eslint-disable @typescript-eslint/no-explicit-any */
// Telegram bot: delivery channel + a full mirror of the app (menus, cards, actions). Free: create a bot with
// @BotFather, put the token in TELEGRAM_BOT_TOKEN, open /api/telegram/setup?secret=CRON_SECRET once.

export const TELEGRAM_ENABLED = () => !!process.env.TELEGRAM_BOT_TOKEN;
const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export type Button = { text: string; url?: string; callback_data?: string };
export type Keyboard = Button[][];

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } }> {
  try {
    const res = await fetch(`${API()}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return (await res.json()) as { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
  } catch (e) { return { ok: false, description: String(e) }; }
}

/** Escape for HTML parse mode. */
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Persistent buttons under the text box (Telegram "reply keyboard"); their labels arrive as plain messages. */
export const REPLY_KEYBOARD: string[][] = [["☀️ Plan", "✅ Trades"], ["🔍 Coin", "👤 Me"], ["🤖 Ask AI", "📋 Menu"]];

export type SendOpts = { url?: string; label?: string; keyboard?: Keyboard; html?: boolean; replyKeyboard?: string[][] | "remove"; replyTo?: number };
export type SendResult = { ok: boolean; error?: string; retryAfter?: number };

/** Send and say what happened: the Telegram error text, and the rate-limit wait when Telegram asks for one. */
export async function tgSendDetailed(chatId: string, text: string, opts: SendOpts = {}): Promise<SendResult> {
  if (!TELEGRAM_ENABLED()) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set" };
  const first = await sendOnce(chatId, text, opts);
  if (first.ok || !opts.html) return first;
  // HTML rejected (bad entity): retry as plain text, keeping the buttons
  return sendOnce(chatId, text.replace(/<[^>]+>/g, ""), { ...opts, html: false });
}

async function sendOnce(chatId: string, text: string, opts: SendOpts): Promise<SendResult> {
  const body: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
  if (opts.replyTo) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
  if (opts.html) body.parse_mode = "HTML";
  const kb: Keyboard = opts.keyboard ?? (opts.url ? [[{ text: opts.label ?? "Open in AsheSignal", url: opts.url }]] : []);
  if (opts.replyKeyboard === "remove") body.reply_markup = { remove_keyboard: true };
  else if (opts.replyKeyboard) body.reply_markup = { keyboard: opts.replyKeyboard.map((r) => r.map((t) => ({ text: t }))), resize_keyboard: true, is_persistent: true, input_field_placeholder: "Tap a button, or type a coin" };
  else if (kb.length) body.reply_markup = { inline_keyboard: kb };
  const r = await call("sendMessage", body);
  return r.ok ? { ok: true } : { ok: false, error: r.description ?? "unknown Telegram error", retryAfter: r.parameters?.retry_after };
}

export async function tgSend(chatId: string, text: string, opts: SendOpts = {}): Promise<boolean> {
  return (await tgSendDetailed(chatId, text, opts)).ok;
}

/** Download one of our own images (share card, chart) so we can upload it; Telegram's own fetch of a slow
 *  generated image times out. Null when it is not an image. */
export async function fetchImage(url: string, timeoutMs = 20_000): Promise<Blob | null> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return await r.blob();
  } catch { return null; }
}
async function upload(method: string, form: FormData): Promise<{ ok: boolean; result?: any; description?: string }> {
  try { const res = await fetch(`${API()}/${method}`, { method: "POST", body: form, cache: "no-store" }); return await res.json(); }
  catch (e) { return { ok: false, description: String(e) }; }
}
const largest = (r: any): string | null => { const ph = r?.photo; return Array.isArray(ph) && ph.length ? ph[ph.length - 1].file_id : null; };

/**
 * Send a photo. `photo` is a URL, a Telegram file_id, or a Blob. URLs are downloaded and uploaded by us first
 * (more reliable than letting Telegram fetch them). Returns the file_id so it can be reused for other chats.
 */
export async function tgPhoto(chatId: string, photo: string | Blob, caption: string, keyboard?: Keyboard): Promise<string | null> {
  if (!TELEGRAM_ENABLED()) return null;
  const blob = typeof photo === "string" && /^https?:/.test(photo) ? await fetchImage(photo) : photo instanceof Blob ? photo : null;
  if (blob) {
    const f = new FormData();
    f.append("chat_id", chatId); f.append("photo", blob, "card.png");
    if (caption) { f.append("caption", caption.slice(0, 1000)); f.append("parse_mode", "HTML"); }
    if (keyboard?.length) f.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
    const r = await upload("sendPhoto", f);
    if (r.ok) return largest(r.result);
  }
  if (typeof photo !== "string") return null;
  const r = await call<any>("sendPhoto", { chat_id: chatId, photo, caption: caption.slice(0, 1000), parse_mode: "HTML", ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  return r.ok ? largest(r.result) : null;
}

/** Several images in one bubble (Telegram album). Items are Blobs or file_ids. Returns the file_ids in order. */
export async function tgAlbum(chatId: string, items: (Blob | string)[], caption?: string): Promise<string[] | null> {
  if (!TELEGRAM_ENABLED() || !items.length) return null;
  const f = new FormData();
  f.append("chat_id", chatId);
  const media = items.map((it, i) => {
    const m: Record<string, unknown> = { type: "photo", media: typeof it === "string" ? it : `attach://p${i}` };
    if (i === 0 && caption) { m.caption = caption.slice(0, 1000); m.parse_mode = "HTML"; }
    if (typeof it !== "string") f.append(`p${i}`, it, `p${i}.png`);
    return m;
  });
  f.append("media", JSON.stringify(media));
  const r = await upload("sendMediaGroup", f);
  return r.ok && Array.isArray(r.result) ? r.result.map((m: any) => largest(m) ?? "") : null;
}

/** Share card + chart as one album (falls back to whichever image rendered). Returns reusable file_ids. */
export async function tgCardImages(chatId: string, imgs: { card?: Blob | string | null; chart?: Blob | string | null }, caption?: string): Promise<{ card?: string; chart?: string } | null> {
  const list = [imgs.card, imgs.chart].filter(Boolean) as (Blob | string)[];
  if (!list.length) return null;
  if (list.length === 1) { const id = await tgPhoto(chatId, list[0], caption ?? ""); return id ? (imgs.card ? { card: id } : { chart: id }) : null; }
  const ids = await tgAlbum(chatId, list, caption);
  if (ids) return { card: ids[0], chart: ids[1] };
  const id = await tgPhoto(chatId, list[0], caption ?? "");
  return id ? { card: id } : null;
}

export async function tgEdit(chatId: string, messageId: number, text: string, keyboard?: Keyboard): Promise<boolean> {
  const r = await call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  return r.ok;
}

export async function tgAnswerCallback(id: string, text?: string) { await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 200) } : {}) }); }
export async function tgTyping(chatId: string) { await call("sendChatAction", { chat_id: chatId, action: "typing" }); }

export async function tgSetWebhook(url: string, secret: string) {
  return call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query", "inline_query"], drop_pending_updates: true });
}
export async function tgAnswerInline(inlineQueryId: string, results: unknown[], switchPmText?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN; if (!token) return false;
  const body: Record<string, unknown> = { inline_query_id: inlineQueryId, results: results.slice(0, 10), cache_time: 60, is_personal: true };
  if (switchPmText) { body.button = { text: switchPmText, start_parameter: "inline" }; }
  const r = await fetch(`https://api.telegram.org/bot${token}/answerInlineQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return !!r?.ok;
}
export async function tgMe() { return call<{ username: string }>("getMe", {}); }

export function linkCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const COMMANDS = [
  { command: "menu", description: "Main menu with buttons" },
  { command: "trades", description: "Confirmed trades you can place on your exchange" },
  { command: "recap", description: "This week's signals, graded" },
  { command: "speculative", description: "Early setups before they are confirmed (off by default)" },
  { command: "whatsnew", description: "What changed in the latest AsheSignal update" },
  { command: "watching", description: "Setups that are close but not confirmed" },
  { command: "spec", description: "Speculative opportunities (high risk)" },
  { command: "spot", description: "Long-term spot picks and their zones" },
  { command: "ask", description: "Ask the AI anything about the market: /ask is BTC still bullish?" },
  { command: "plan", description: "Today's plan: stance, open trades, setups in zone, budget" },
  { command: "top", description: "The 3 best confirmed setups for your exchange" },
  { command: "record", description: "The engine's public track record" },
  { command: "simulate", description: "What taking every confirmed signal would have done" },
  { command: "compare", description: "Two coins side by side: /compare BTC ETH" },
  { command: "events", description: "Upcoming high-impact calendar events" },
  { command: "heat", description: "Your open risk vs your limits" },
  { command: "holdings", description: "Engine view on every coin you hold" },
  { command: "dca", description: "Spread a spot buy across the zone: /dca BTC 200" },
  { command: "movers", description: "Today's gainers, losers and new confirmations" },
  { command: "learn", description: "Short trading lessons with quizzes" },
  { command: "leaderboard", description: "Group: weekly R leaderboard (/optin to join)" },
  { command: "optin", description: "Group: appear on the leaderboard" },
  { command: "optout", description: "Group: leave the leaderboard" },
  { command: "mywatch", description: "Group: add a coin to your personal watchlist" },
  { command: "unwatch", description: "Remove a coin from the watchlist" },
  { command: "cancel", description: "Stop the current guided flow" },
  { command: "today", description: "Trade conditions, regime, Fear & Greed" },
  { command: "coin", description: "Analysis of a coin, e.g. /coin SOL 4h" },
  { command: "scan", description: "Any token on any chain by contract address" },
  { command: "screener", description: "Top coins by score, RSI, volume" },
  { command: "size", description: "Position size: /size ENTRY STOP [balance] [risk%]" },
  { command: "alert", description: "Price alert: /alert BTC above 100000" },
  { command: "alerts", description: "Your alert rules and inbox" },
  { command: "me", description: "Open trades, heat, recent record" },
  { command: "journal", description: "Recent trades and stats" },
  { command: "take", description: "Record a trade: /take SOL" },
  { command: "watchlist", description: "Your starred coins with status and entry zone" },
  { command: "watch", description: "Star a coin: /watch SOL (unstar: /unwatch)" },
  { command: "review", description: "Your weekly review" },
  { command: "digest", description: "Today's digest, now" },
  { command: "settings", description: "Exchange, digest, signals, link status" },
  { command: "signals", description: "Automatic confirmed-trade messages: /signals on|off" },
  { command: "exchange", description: "Your exchange: /exchange coinbase" },
  { command: "guide", description: "How to place a trade on your exchange" },
  { command: "link", description: "Connect this chat to your account" },
  { command: "help", description: "All commands" },
];

/** Register the "/" command menu and the bot description shown before Start. */
export async function tgRegisterCommands() {
  const [cmds, groupCmds, desc, short] = await Promise.all([
    call("setMyCommands", { commands: COMMANDS, scope: { type: "default" } }),
    call("setMyCommands", { commands: COMMANDS.filter((c) => !["link"].includes(c.command)), scope: { type: "all_group_chats" } }),
    call("setMyDescription", { description: "AsheSignal in Telegram: trade conditions, confirmed setups with entry, targets and stop, coin analysis, spot picks, position sizing, alerts and your trading journal. Everything the website shows, with buttons. Manual trading only. Not financial advice." }),
    call("setMyShortDescription", { short_description: "Crypto setups, conditions, analysis and journal from AsheSignal. Manual trading only." }),
  ]);
  return { commands: cmds, groupCommands: groupCmds, description: desc, shortDescription: short };
}
