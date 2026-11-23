import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildRecap, weekId } from "@/lib/recap";
import { loadRecipients } from "@/lib/telegram-broadcast";
import { tgSend } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly recap to everyone with signals on. Called by the worker every 5 minutes; it only sends on Sunday from
 * 18:00 UTC, once per week (remembered in engine_config). ?force=1 sends now, ?dry=1 only returns the text.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (process.env.CRON_SECRET && q.get("secret") !== process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ ok: false, error: "no database" });
  const now = new Date(), wk = weekId(now);
  const force = q.get("force") === "1", dry = q.get("dry") === "1";
  if (!force && !dry && !(now.getUTCDay() === 0 && now.getUTCHours() >= 18)) return NextResponse.json({ ok: true, skipped: "not Sunday evening (UTC)", week: wk });
  if (!force && !dry) {
    const { data: last } = await sb.from("engine_config").select("value").eq("key", "recap_last").maybeSingle();
    if ((last?.value as { week?: string } | null)?.week === wk) return NextResponse.json({ ok: true, skipped: "already sent", week: wk });
  }
  const recap = await buildRecap(sb);
  if (dry) return NextResponse.json({ ok: true, week: wk, recap });
  // Mark first, so a slow send can never produce two recaps.
  await sb.from("engine_config").upsert({ key: "recap_last", value: { week: wk, at: now.toISOString() }, note: "weekly recap sent", updated_at: now.toISOString() });
  const recipients = await loadRecipients(sb);
  let sent = 0, failed = 0;
  for (const r of recipients) {
    for (const m of recap.messages) {
      if (await tgSend(r.chatId, m, { html: true })) sent++; else failed++;
      await new Promise((res) => setTimeout(res, 60));
    }
  }
  return NextResponse.json({ ok: true, week: wk, sent, failed, recipients: recipients.length, messages: recap.messages.length, total: recap.total, delivered: recap.delivered.signals, legacy: recap.legacy });
}
