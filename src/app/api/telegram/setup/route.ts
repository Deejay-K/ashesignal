import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/supabase/admin";
import { TELEGRAM_ENABLED, tgMe, tgSetWebhook, tgRegisterCommands } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Registers the Telegram webhook for this deployment. Open once: /api/telegram/setup?secret=<CRON_SECRET> */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!TELEGRAM_ENABLED()) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 501 });
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL not set" }, { status: 501 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.CRON_SECRET!;
  const [hook, me, menu] = await Promise.all([tgSetWebhook(`${site.replace(/\/$/, "")}/api/telegram/webhook`, secret), tgMe(), tgRegisterCommands()]);
  return NextResponse.json({ ok: true, webhook: hook, commandMenu: menu.commands?.ok ? `registered: ${menu.inPrivateChats ?? "?"} of ${menu.expected} in private chats, ${menu.inGroups ?? "?"} in groups` : menu.commands, bot: me.result?.username ? `@${me.result.username}` : null, next: "On the Account page, press Connect Telegram and send the code to the bot. For group chats, disable privacy mode in @BotFather (/setprivacy) so the bot sees plain questions, or address it with /trades@YourBot." });
}
