import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { deliver } from "@/lib/alerts/notify";

export const dynamic = "force-dynamic";

/** Sends one test notification to every channel the user has set up (push, email, Discord, Telegram). */
export async function POST() {
  const sb = await supabaseServer();
  const auth = sb ? await sb.auth.getUser() : null;
  if (!sb || !auth?.data.user) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const r = await deliver(sb, { userId: auth.data.user.id, alertId: null, symbol: "TEST", force: true, title: "Test notification from AsheSignal", body: "If you can read this, this channel works. Quiet hours and type toggles were ignored for this test.", url: "/account", channels: ["push", "email"] });
  return NextResponse.json({ ok: true, ...r });
}
