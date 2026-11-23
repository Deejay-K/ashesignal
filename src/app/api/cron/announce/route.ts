import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { releaseHtml, releaseText, unannounced } from "@/lib/changelog";
import { loadRecipients } from "@/lib/telegram-broadcast";
import { tgSendDetailed } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface State { version: string; phase: "web" | "telegram" | "done"; cursor: string | number; lastDone?: string | null }
const KEY = "announcement";

/**
 * Announces every release not yet announced, once: an inbox notification for every member on the website, then one
 * Telegram message to every person and group with signals switched on. Resumes across ticks (state in engine_config)
 * and does nothing once done.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  try {
    const { data: row } = await sb.from("engine_config").select("value").eq("key", KEY).maybeSingle();
    const prev = row?.value as State | null;
    // Everything newer than the last release that was fully announced goes out together, in one message.
    const lastDone = prev?.phase === "done" ? prev.version : prev?.lastDone ?? null;
    const pending = unannounced(lastDone);
    if (!pending.length) return NextResponse.json({ ok: true, skipped: "already announced", version: lastDone });
    const target = pending[0].version;
    const st: State = prev && prev.version === target && prev.phase !== "done" ? prev : { version: target, phase: "web", cursor: "", lastDone };
    const started = Date.now();
    let inbox = 0, telegram = 0, failed = 0;

    if (st.phase === "web") {
      // Keyset pagination on the user id, 500 per tick.
      let q = sb.from("profiles").select("id").order("id", { ascending: true }).limit(500);
      if (st.cursor) q = q.gt("id", String(st.cursor));
      const { data: users, error } = await q;
      if (error) throw new Error(`profiles: ${error.message}`);
      const rows = (users ?? []).map((u: { id: string }) => ({ user_id: u.id, symbol: "ASHE", title: `What's new: update ${target}`, body: releaseText(pending), url: "/whats-new" }));
      if (rows.length) {
        const { error: ie } = await sb.from("alert_events").insert(rows);
        if (ie) throw new Error(`alert_events: ${ie.message}`);
        inbox += rows.length;
      }
      st.cursor = users?.length ? users[users.length - 1].id : st.cursor;
      if (!users || users.length < 500) { st.phase = "telegram"; st.cursor = ""; }
      await save(sb, st);
    }

    if (st.phase === "telegram") {
      // Sorted by chat id and resumed after the last id sent, so the order can never shift between ticks.
      const recipients = (await loadRecipients(sb)).sort((a, b) => a.chatId.localeCompare(b.chatId));
      const text = releaseHtml(pending);
      const after = typeof st.cursor === "string" ? st.cursor : "";
      const todo = recipients.filter((r) => !after || r.chatId.localeCompare(after) > 0);
      let n = 0;
      for (const r of todo) {
        if (Date.now() - started > 40_000) break;
        const res = await tgSendDetailed(r.chatId, text, { html: true });
        if (res.ok) telegram++; else failed++;
        st.cursor = r.chatId; n++;
        if (n % 20 === 0) await save(sb, st);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      if (n >= todo.length) st.phase = "done";
      await save(sb, st);
    }
    return NextResponse.json({ ok: true, version: target, releases: pending.map((r) => r.version), phase: st.phase, inbox, telegram, failed, at: new Date().toISOString() });
  } catch (e) {
    console.error(`[announce] ${(e as Error).message}`);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function save(sb: NonNullable<ReturnType<typeof supabaseAdmin>>, st: State) {
  const { error } = await sb.from("engine_config").upsert({ key: KEY, value: st, note: "release announcement progress", updated_at: new Date().toISOString() });
  if (error) throw new Error(`engine_config: ${error.message}`);
}
