// Telegram bot: delivery channel + a full mirror of the app (menus, cards, actions). Free: create a bot with
// @BotFather, put the token in TELEGRAM_BOT_TOKEN, open /api/telegram/setup?secret=CRON_SECRET once.

export const TELEGRAM_ENABLED = () => !!process.env.TELEGRAM_BOT_TOKEN;
const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export type Button = { text: string; url?: string; callback_data?: string };
export type Keyboard = Button[][];

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const res = await fetch(`${API()}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch (e) { return { ok: false, description: String(e) }; }
}

/** Escape for HTML parse mode. */
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function tgSend(chatId: string, text: string, opts: { url?: string; label?: string; keyboard?: Keyboard; html?: boolean } = {}): Promise<boolean> {
  if (!TELEGRAM_ENABLED()) return false;
  const body: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
  if (opts.html) body.parse_mode = "HTML";
  const kb: Keyboard = opts.keyboard ?? (opts.url ? [[{ text: opts.label ?? "Open in AsheSignal", url: opts.url }]] : []);
  if (kb.length) body.reply_markup = { inline_keyboard: kb };
  const r = await call("sendMessage", body);
  if (!r.ok && opts.html) { // HTML rejected (bad entity): retry as plain text
    return (await call("sendMessage", { chat_id: chatId, text: text.replace(/<[^>]+>/g, "").slice(0, 4000), disable_web_page_preview: true, ...(kb.length ? { reply_markup: { inline_keyboard: kb } } : {}) })).ok;
  }
  return r.ok;
}

export async function tgPhoto(chatId: string, photoUrl: string, caption: string, keyboard?: Keyboard): Promise<boolean> {
  const r = await call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption: caption.slice(0, 1000), parse_mode: "HTML", ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  return r.ok;
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
  { command: "watching", description: "Setups that are close but not confirmed" },
  { command: "spec", description: "Speculative opportunities (high risk)" },
  { command: "spot", description: "Long-term spot picks and their zones" },
  { command: "top", description: "The 3 best confirmed setups for your exchange" },
  { command: "today", description: "Trade conditions, regime, Fear & Greed" },
  { command: "coin", description: "Analysis of a coin, e.g. /coin SOL 4h" },
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
    call("setMyCommands", { commands: COMMANDS.filter((c) => !["link", "me", "journal", "take", "alerts", "alert", "review", "digest", "watch"].includes(c.command)), scope: { type: "all_group_chats" } }),
    call("setMyDescription", { description: "AsheSignal in Telegram: trade conditions, confirmed setups with entry, targets and stop, coin analysis, spot picks, position sizing, alerts and your trading journal. Everything the website shows, with buttons. Manual trading only. Not financial advice." }),
    call("setMyShortDescription", { short_description: "Crypto setups, conditions, analysis and journal from AsheSignal. Manual trading only." }),
  ]);
  return { commands: cmds, groupCommands: groupCmds, description: desc, shortDescription: short };
}
