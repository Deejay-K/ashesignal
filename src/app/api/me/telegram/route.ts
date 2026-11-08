import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { linkCode, TELEGRAM_ENABLED, tgMe } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** GET: status + a fresh link code. DELETE: unlink. */
export async function GET() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!TELEGRAM_ENABLED()) return NextResponse.json({ enabled: false });
  const { data: p } = await sb.from("profiles").select("telegram_chat_id, telegram_link_code").eq("id", auth.user.id).maybeSingle();
  let code = p?.telegram_link_code;
  if (!p?.telegram_chat_id && !code) { code = linkCode(); await sb.from("profiles").update({ telegram_link_code: code }).eq("id", auth.user.id); }
  const me = await tgMe().catch(() => null);
  return NextResponse.json({ enabled: true, linked: !!p?.telegram_chat_id, code: p?.telegram_chat_id ? null : code, bot: me?.result?.username ? `@${me.result.username}` : null });
}

export async function DELETE() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await sb.from("profiles").update({ telegram_chat_id: null, telegram_link_code: linkCode() }).eq("id", auth.user.id);
  return NextResponse.json({ ok: true });
}
