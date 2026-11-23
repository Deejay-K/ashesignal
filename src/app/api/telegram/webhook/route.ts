import { NextRequest, NextResponse, after } from "next/server";
import { runWatchdog } from "@/lib/watchdog";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TELEGRAM_ENABLED, tgSend } from "@/lib/telegram";
import { loadActor, handleCommand, handleCallback, handleStateReply, handleInline, touchGroupMember, labelToCommand, type ChatCtx } from "@/lib/telegram-bot";
import { ensureEngineConfig } from "@/lib/engine-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Telegram webhook. Mirrors the website: discovery categories, coin analysis with share cards, screener,
 * sizing, alerts, journal and the assistant, all through commands and inline buttons. Works in private
 * chats and groups (in groups: commands, mentions, replies and button taps only).
 */
export async function POST(req: NextRequest) {
  if (!TELEGRAM_ENABLED()) return NextResponse.json({ ok: false }, { status: 501 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.CRON_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });
  const sb = supabaseAdmin();
  // Stage 54: every tap doubles as a health check (at most once every 10 minutes), run after the reply is sent.
  if (sb) after(() => runWatchdog(sb).then(() => undefined));

  try {
    // Inline mode: @AsheSignalBot SOL typed in any chat
    if (update.inline_query?.id) {
      if (sb) { await ensureEngineConfig(); await handleInline(sb, update.inline_query); }
      return NextResponse.json({ ok: true });
    }
    // Button taps
    const cb = update.callback_query;
    if (cb?.message?.chat?.id != null && typeof cb.data === "string") {
      const chatId = String(cb.message.chat.id);
      if (!sb) { await tgSend(chatId, "This deployment has no database configured."); return NextResponse.json({ ok: true }); }
      await ensureEngineConfig();
      const tgUserId = String(cb.from?.id ?? chatId);
      const chat = await loadActor(sb, tgUserId, chatId, { firstName: cb.from?.first_name, username: cb.from?.username, chatTitle: cb.message.chat.title });
      const ctx: ChatCtx = { sb, chatId, tgUserId, firstName: cb.from?.first_name, userId: chat.userId, venue: chat.venue, state: chat.state, isGroup: cb.message.chat.type !== "private", messageId: cb.message.message_id };
      try { await handleCallback(ctx, cb.data, cb.id); }
      catch (e) { console.error("telegram callback", cb.data, e); await tgSend(chatId, `That button hit an error (${String((e as Error).message).slice(0, 120)}). Try /menu.`); }
      return NextResponse.json({ ok: true });
    }

    const msg = update.message ?? update.edited_message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
    let text: string = (msg?.text ?? msg?.caption ?? "").trim();
    if (!chatId || !text) return NextResponse.json({ ok: true });
    const isGroup = msg.chat?.type === "group" || msg.chat?.type === "supergroup";
    if (!sb) { await tgSend(chatId, "This deployment has no database configured."); return NextResponse.json({ ok: true }); }
    await ensureEngineConfig();
    const tgUserId = String(msg.from?.id ?? chatId);
    const chat = await loadActor(sb, tgUserId, chatId, { firstName: msg.from?.first_name, username: msg.from?.username, chatTitle: msg.chat.title });
    const ctx: ChatCtx = { sb, chatId, tgUserId, firstName: msg.from?.first_name, userId: chat.userId, venue: chat.venue, state: chat.state, isGroup, messageId: msg.message_id };
    if (isGroup) await touchGroupMember(sb, chatId, tgUserId, msg.from?.first_name);
    // Replying to one of the bot's messages: hand its text to the AI so the answer is about that message.
    if (msg.reply_to_message?.from?.is_bot) ctx.quoted = String(msg.reply_to_message.text ?? msg.reply_to_message.caption ?? "").slice(0, 2000) || null;

    // This user's guided flow (recording a trade) is waiting for a plain answer; the flow is per user, so in a
    // group only that person's messages are read as answers.
    if (!text.startsWith("/") && chat.state?.flow) {
      if (await handleStateReply(ctx, text.replace(/@\w+/g, "").trim())) return NextResponse.json({ ok: true });
    }
    if (isGroup && !text.startsWith("/") && !labelToCommand(text)) {
      // In groups only react when addressed (mention or reply to the bot), so the bot does not answer every message.
      const mentioned = /@\w*bot\b/i.test(text) || msg.reply_to_message?.from?.is_bot;
      if (!mentioned) return NextResponse.json({ ok: true });
      text = text.replace(/@\w+/g, "").trim();
    }
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    try { await handleCommand(ctx, text.startsWith("/") ? cmd : "", arg, text); }
    catch (e) { console.error("telegram command", text, e); await tgSend(chatId, `That command hit an error (${String((e as Error).message).slice(0, 120)}). Try /menu.`); }
  } catch (e) {
    console.error("telegram webhook", e);
  }
  return NextResponse.json({ ok: true });
}
