// Telegram bot: delivery channel + two-way commands. Free: create a bot with @BotFather, put the token in
// TELEGRAM_BOT_TOKEN, open /api/telegram/setup?secret=CRON_SECRET once to register the webhook.

export const TELEGRAM_ENABLED = () => !!process.env.TELEGRAM_BOT_TOKEN;
const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function tgSend(chatId: string, text: string, opts: { url?: string; label?: string } = {}): Promise<boolean> {
  if (!TELEGRAM_ENABLED()) return false;
  const body: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
  if (opts.url) body.reply_markup = { inline_keyboard: [[{ text: opts.label ?? "Open in AsheSignal", url: opts.url }]] };
  try {
    const res = await fetch(`${API()}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return res.ok;
  } catch { return false; }
}

export async function tgSetWebhook(url: string, secret: string) {
  const res = await fetch(`${API()}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }), cache: "no-store" });
  return res.json();
}

export async function tgMe() {
  const res = await fetch(`${API()}/getMe`, { cache: "no-store" });
  return res.json() as Promise<{ ok: boolean; result?: { username: string } }>;
}

export function linkCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
