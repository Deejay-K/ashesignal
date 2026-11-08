// Notification delivery: Web Push (VAPID) + email (Resend). Both optional.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Notification {
  userId: string;
  alertId?: string | null;
  symbol: string;
  title: string;
  body: string;
  url?: string;
  /** per-alert channel choice: "push" | "email" (inbox is always written) */
  channels?: string[];
}

export const PUSH_ENABLED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const EMAIL_ENABLED = Boolean(process.env.RESEND_API_KEY);

export async function deliver(sb: SupabaseClient, n: Notification): Promise<{ push: number; email: boolean; discord: boolean }> {
  // always log it so the in-app bell can show it
  await sb.from("alert_events").insert({ user_id: n.userId, alert_id: n.alertId ?? null, symbol: n.symbol, title: n.title, body: n.body, url: n.url ?? null });

  const { data: profile } = await sb.from("profiles").select("email, notify_email, notify_push, discord_webhook").eq("id", n.userId).maybeSingle();
  let push = 0;
  let email = false;
  let discord = false;

  const wantPush = n.channels ? n.channels.includes("push") : true;
  const wantEmail = n.channels ? n.channels.includes("email") : !!profile?.notify_email;
  if (PUSH_ENABLED && wantPush && profile?.notify_push !== false) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:alerts@ashesignal.app", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, keys").eq("user_id", n.userId);
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify({ title: n.title, body: n.body, url: n.url ?? "/alerts" }));
        push++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // expired subscription
      }
    }
  }

  if (EMAIL_ENABLED && wantEmail && profile?.email) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.ALERT_EMAIL_FROM ?? "AsheSignal <onboarding@resend.dev>",
        to: profile.email,
        subject: `[AsheSignal] ${n.title}`,
        text: `${n.body}\n\n${n.url ? `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}${n.url}` : ""}`,
      });
      email = true;
    } catch (e) {
      console.warn("email failed", (e as Error).message);
    }
  }
  // Discord: a webhook the user pasted on the Account page. Embed with title, body and link.
  if (profile?.discord_webhook && /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(profile.discord_webhook)) {
    try {
      const color = /stop|loss|avoid|risk-off|lost/i.test(n.title) ? 0xef4444 : /TP|confirmed|profit|win/i.test(n.title) ? 0x36bd94 : 0x6b7280;
      const res = await fetch(profile.discord_webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "AsheSignal", embeds: [{ title: n.title.slice(0, 256), description: n.body.slice(0, 3900), color, url: n.url ? `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}${n.url}` : undefined, footer: { text: "Manual trading only. Not financial advice." }, timestamp: new Date().toISOString() }] }) });
      discord = res.ok;
      if (res.status === 404 || res.status === 401) await sb.from("profiles").update({ discord_webhook: null }).eq("id", n.userId); // webhook deleted on Discord's side
    } catch (e) { console.warn("discord failed", (e as Error).message); }
  }
  return { push, email, discord };
}
