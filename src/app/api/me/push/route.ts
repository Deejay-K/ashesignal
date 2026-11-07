import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null, email: Boolean(process.env.RESEND_API_KEY) });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (b?.notifyEmail != null || b?.notifyPush != null) {
    const patch: Record<string, unknown> = {};
    if (b.notifyEmail != null) patch.notify_email = b.notifyEmail;
    if (b.notifyPush != null) patch.notify_push = b.notifyPush;
    await sb.from("profiles").upsert({ id: u.user.id, ...patch });
    return NextResponse.json({ ok: true });
  }
  if (!b?.subscription?.endpoint) return NextResponse.json({ error: "subscription required" }, { status: 400 });
  const { error } = await sb.from("push_subscriptions").upsert({ user_id: u.user.id, endpoint: b.subscription.endpoint, keys: b.subscription.keys }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (endpoint) await sb.from("push_subscriptions").delete().eq("user_id", u.user.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
