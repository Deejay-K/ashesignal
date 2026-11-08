import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { deliver } from "@/lib/alerts/notify";

export const dynamic = "force-dynamic";

export async function POST() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await deliver(sb, { userId: auth.user.id, alertId: null, symbol: "TEST", title: "AsheSignal is connected to this channel", body: "Alerts, the daily digest and the weekly review will appear here. Manual trading only.", url: "/alerts", channels: [] });
  if (!r.discord) return NextResponse.json({ error: "Discord did not accept the message. Check the webhook URL (and that the channel still exists)." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
