import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TELEGRAM_ENABLED, tgSend } from "@/lib/telegram";
import { answer } from "@/lib/ai/assistant";
import { isVenueId, VENUE_META, type VenueId } from "@/lib/venues";
import { ensureEngineConfig } from "@/lib/engine-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const HELP = `AsheSignal bot. Commands:
/link CODE - connect this chat to your account (code on the Account page)
/today - conditions and regime
/trades - confirmed trades you can place on your exchange
/me - your open trades, heat and recent record
/coin SOL - what the engine says about a coin
/unlink - disconnect
Or just ask a question in plain words. Manual trading only; never financial advice.`;

/** Telegram webhook: links chats, answers commands and free-text questions through the assistant. */
export async function POST(req: NextRequest) {
  if (!TELEGRAM_ENABLED()) return NextResponse.json({ ok: false }, { status: 501 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.CRON_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  const text: string = (msg?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });
  const sb = supabaseAdmin();
  if (!sb) { await tgSend(chatId, "This deployment has no database configured."); return NextResponse.json({ ok: true }); }
  await ensureEngineConfig();

  const { data: profile } = await sb.from("profiles").select("id, preferences, telegram_chat_id").eq("telegram_chat_id", chatId).maybeSingle();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  const c = cmd.toLowerCase().replace(/@.*$/, "");

  if (c === "/start" || c === "/help") { await tgSend(chatId, HELP, { url: SITE() || undefined, label: "Open AsheSignal" }); return NextResponse.json({ ok: true }); }
  if (c === "/link") {
    const code = arg.toUpperCase();
    if (!code) { await tgSend(chatId, "Send /link followed by the 6-character code shown on your Account page."); return NextResponse.json({ ok: true }); }
    const { data: owner } = await sb.from("profiles").select("id").eq("telegram_link_code", code).maybeSingle();
    if (!owner) { await tgSend(chatId, "That code is not valid or has expired. Open the Account page, press Connect Telegram and use the new code."); return NextResponse.json({ ok: true }); }
    await sb.from("profiles").update({ telegram_chat_id: chatId, telegram_link_code: null }).eq("id", owner.id);
    await tgSend(chatId, "Linked. Alerts, the daily digest and the weekly review will arrive here. Try /trades or /me.");
    return NextResponse.json({ ok: true });
  }
  if (c === "/unlink") {
    if (profile) await sb.from("profiles").update({ telegram_chat_id: null }).eq("id", profile.id);
    await tgSend(chatId, "Disconnected. Nothing more will be sent here.");
    return NextResponse.json({ ok: true });
  }
  const venue: VenueId = isVenueId(profile?.preferences?.venue) ? profile!.preferences.venue : "binance";
  const question = c === "/today" ? "Is it a good time to trade today, and what is the market regime?" : c === "/trades" ? `What can I trade on ${VENUE_META[venue].label} right now?` : c === "/me" ? "How am I doing: my open trades, heat and recent record" : c === "/coin" ? (arg ? `What does the engine say about ${arg}?` : "Send /coin followed by a ticker, e.g. /coin SOL") : c.startsWith("/") ? HELP : text;
  if (c === "/coin" && !arg) { await tgSend(chatId, question); return NextResponse.json({ ok: true }); }
  if (c.startsWith("/") && !["/today", "/trades", "/me", "/coin"].includes(c)) { await tgSend(chatId, HELP); return NextResponse.json({ ok: true }); }
  if ((c === "/me" || /my (trades|journal|heat)|how am i/i.test(text)) && !profile) { await tgSend(chatId, "Link your account first: /link CODE (code on the Account page)."); return NextResponse.json({ ok: true }); }

  try {
    const a = await answer({ question, venue, userId: profile?.id ?? null, sb: profile ? sb : null, adminSb: sb });
    const body = [a.text, ...(a.bullets?.length ? ["", ...a.bullets.map((b) => `- ${b}`)] : [])].join("\n");
    const link = a.links[0];
    await tgSend(chatId, body + "\n\nNot financial advice. Manual trading only.", link && SITE() ? { url: `${SITE()}${link.href}`, label: link.label } : {});
  } catch (e) {
    await tgSend(chatId, `Could not answer right now: ${(e as Error).message}`);
  }
  return NextResponse.json({ ok: true });
}
