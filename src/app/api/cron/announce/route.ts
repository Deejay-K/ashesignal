import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { LATEST, releaseHtml, releaseText } from "@/lib/changelog";
import { loadRecipients } from "@/lib/telegram-broadcast";
import { tgSendDetailed } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface State { version: string; phase: "web" | "telegram" | "done"; cursor: string | number }
const KEY = "announcement";

/**
 * Announces the newest release once: an inbox notification for every member on the website, then a Telegram message to
 * everyone with Telegram linked. Resumes across ticks (state in engine_config) and does nothing once done.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  try {
    const { data: row } = await sb.from("engine_config").select("value").eq("key", KEY).maybeSingle();
    const cur = row?.value as State | null;
    const st: State = cur && cur.version === LATEST.version ? cur : { version: LATEST.version, phase: "web", cursor: "" };
    if (st.phase === "done") return NextResponse.json({ ok: true, skipped: "already announced", version: LATEST.version });
    const started = Date.now();
    let inbox = 0, telegram = 0, failed = 0;

    if (st.phase === "web") {
      // Keyset pagination on the user id, 500 per tick.
      let q = sb.from("profiles").select("id").order("id", { ascending: true }).limit(500);
      if (st.cursor) q = q.gt("id", String(st.cursor));
      const { data: users, error } = await q;
      if (error) throw new Error(`profiles: ${error.message}`);
      const rows = (users ?? []).map((u: { id: string }) => ({ user_id: u.id, symbol: "ASHE", title: `What's new: update ${LATEST.version}`, body: releaseText(), url: "/whats-new" }));
      if (rows.length) {
        const { error: ie } = await sb.from("alert_events").insert(rows);
        if (ie) throw new Error(`alert_events: ${ie.message}`);
        inbox += rows.length;
      }
      st.cursor = users?.length ? users[users.length - 1].id : st.cursor;
      if (!users || users.length < 500) { st.phase = "telegram"; st.cursor = 0; }
      await save(sb, st);
    }

    if (st.phase === "telegram") {
      const recipients = await loadRecipients(sb);
      const text = releaseHtml();
      let i = Number(st.cursor) || 0;
      while (i < recipients.length && Date.now() - started < 40_000) {
        const r = recipients[i++];
        const res = await tgSendDetailed(r.chatId, text, { html: true });
        if (res.ok) telegram++; else failed++;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      st.cursor = i;
      if (i >= recipients.length) st.phase = "done";
      await save(sb, st);
    }
    return NextResponse.json({ ok: true, version: LATEST.version, phase: st.phase, inbox, telegram, failed, at: new Date().toISOString() });
  } catch (e) {
    console.error(`[announce] ${(e as Error).message}`);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function save(sb: NonNullable<ReturnType<typeof supabaseAdmin>>, st: State) {
  const { error } = await sb.from("engine_config").upsert({ key: KEY, value: st, note: "release announcement progress", updated_at: new Date().toISOString() });
  if (error) throw new Error(`engine_config: ${error.message}`);
}
