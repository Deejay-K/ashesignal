import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TELEGRAM_ENABLED, tgSend } from "@/lib/telegram";
import { loadChat, handleCommand, handleCallback, handleStateReply, type ChatCtx } from "@/lib/telegram-bot";
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

  try {
    // Button taps
    const cb = update.callback_query;
    if (cb?.message?.chat?.id != null && typeof cb.data === "string") {
      const chatId = String(cb.message.chat.id);
      if (!sb) { await tgSend(chatId, "This deployment has no database configured."); return NextResponse.json({ ok: true }); }
      await ensureEngineConfig();
      const chat = await loadChat(sb, chatId, cb.message.chat.title);
      const ctx: ChatCtx = { sb, chatId, userId: chat.userId, venue: chat.venue, state: chat.state, isGroup: cb.message.chat.type !== "private", messageId: cb.message.message_id };
      await handleCallback(ctx, cb.data, cb.id);
      return NextResponse.json({ ok: true });
    }

    const msg = update.message ?? update.edited_message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
    let text: string = (msg?.text ?? msg?.caption ?? "").trim();
    if (!chatId || !text) return NextResponse.json({ ok: true });
    const isGroup = msg.chat?.type === "group" || msg.chat?.type === "supergroup";
    if (!sb) { await tgSend(chatId, "This deployment has no database configured."); return NextResponse.json({ ok: true }); }
    await ensureEngineConfig();
    const chat = await loadChat(sb, chatId, msg.chat.title);
    const ctx: ChatCtx = { sb, chatId, userId: chat.userId, venue: chat.venue, state: chat.state, isGroup, messageId: msg.message_id };

    // A guided flow (recording a trade) is waiting for a plain answer
    if (!text.startsWith("/") && chat.state?.flow) {
      if (isGroup && msg.reply_to_message?.from?.is_bot !== true && !/@\w*bot\b/i.test(text)) return NextResponse.json({ ok: true });
      if (await handleStateReply(ctx, text.replace(/@\w+/g, "").trim())) return NextResponse.json({ ok: true });
    }
    if (isGroup && !text.startsWith("/")) {
      // In groups only react when addressed (mention or reply to the bot), so the bot does not answer every message.
      const mentioned = /@\w*bot\b/i.test(text) || msg.reply_to_message?.from?.is_bot;
      if (!mentioned) return NextResponse.json({ ok: true });
      text = text.replace(/@\w+/g, "").trim();
    }
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    await handleCommand(ctx, text.startsWith("/") ? cmd : "", arg, text);
  } catch (e) {
    console.error("telegram webhook", e);
  }
  return NextResponse.json({ ok: true });
}
