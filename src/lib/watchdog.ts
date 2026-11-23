// Stage 54 - watchdog and ledger health.
//
// The worker runs on GitHub Actions. If it stops, nothing inside it can say so. The watchdog runs from places that
// keep working when the worker does not: the Telegram webhook (every member's tap, at most once every 10 minutes),
// the /status page, and a daily Vercel cron. It alerts the admins (ADMIN_EMAILS with Telegram linked) once when
// something stops, every 6 hours while it stays down, and once when it recovers.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSendDetailed, esc } from "./telegram";

const KEY = "watchdog";
const CHECK_EVERY_MS = 10 * 60_000;
const WORKER_DOWN_MIN = 30;
const QUEUE_STUCK_MIN = 20;
const REMIND_MS = 6 * 3_600_000;

interface WatchState { checkedAt?: string; state?: "ok" | "down"; problems?: string[]; alertedAt?: string | null }
export interface WatchResult { checked: boolean; state: "ok" | "down"; problems: string[]; alerted: number; skipped?: string }

/** What is wrong right now, in plain sentences. Empty = all good. */
export async function watchProblems(sb: SupabaseClient, now = Date.now()): Promise<string[]> {
  const problems: string[] = [];
  const { data: m, error } = await sb.from("coin_metrics").select("updated_at").order("updated_at", { ascending: false }).limit(1);
  if (error) return [`Could not read the screener table: ${error.message}`];
  const last = m?.[0]?.updated_at as string | undefined;
  const mins = last ? (now - Date.parse(last)) / 60_000 : Infinity;
  if (mins > WORKER_DOWN_MIN) problems.push(last ? `The 5-minute worker has not run for ${Math.round(mins)} minutes (last screener run ${last.slice(0, 16).replace("T", " ")} UTC). No new signals are found or sent.` : "The worker has never run.");
  const stuck = await sb.from("signals").select("id", { count: "exact", head: true }).is("processed_at", null).lt("created_at", new Date(now - QUEUE_STUCK_MIN * 60_000).toISOString());
  if (!stuck.error && (stuck.count ?? 0) > 0) problems.push(`${stuck.count} signal${stuck.count === 1 ? " has" : "s have"} waited more than ${QUEUE_STUCK_MIN} minutes to be sent. Check the deliver step in GitHub Actions and TELEGRAM_BOT_TOKEN.`);
  return problems;
}

/** Telegram chats of the admins (ADMIN_EMAILS) who linked Telegram on the Account page. */
async function adminChats(sb: SupabaseClient): Promise<string[]> {
  const emails = (process.env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x && !x.includes(","));
  if (!emails.length) return [];
  const { data } = await sb.from("profiles").select("email, telegram_chat_id").or(emails.map((e) => `email.ilike.${e}`).join(",")).not("telegram_chat_id", "is", null);
  return [...new Set((data ?? []).filter((p: { email?: string | null }) => emails.includes(String(p.email ?? "").toLowerCase())).map((p: { telegram_chat_id: string | number }) => String(p.telegram_chat_id)))];
}

/**
 * Check and alert. Throttled to once every 10 minutes unless forced. Never throws (it runs after webhook replies).
 * `now` is only for tests.
 */
export async function runWatchdog(sb: SupabaseClient, opts: { force?: boolean; now?: number } = {}): Promise<WatchResult> {
  const now = opts.now ?? Date.now();
  try {
    const { data: row } = await sb.from("engine_config").select("value").eq("key", KEY).maybeSingle();
    const st = (row?.value ?? {}) as WatchState;
    if (!opts.force && st.checkedAt && now - Date.parse(st.checkedAt) < CHECK_EVERY_MS) return { checked: false, state: st.state ?? "ok", problems: st.problems ?? [], alerted: 0, skipped: "checked recently" };
    // Claim the check first, so two webhook calls at the same moment do not both alert.
    await sb.from("engine_config").upsert({ key: KEY, value: { ...st, checkedAt: new Date(now).toISOString() }, note: "watchdog state", updated_at: new Date(now).toISOString() });
    const problems = await watchProblems(sb, now);
    const state: "ok" | "down" = problems.length ? "down" : "ok";
    const plan = alertPlan(st, state, now);
    let alerted = 0, alertedAt = st.alertedAt ?? null;
    if (plan !== "none") {
      const text = plan === "recovered"
        ? "✅ <b>AsheSignal is running again</b>\nThe worker and the signal sender are back to normal."
        : `🚨 <b>AsheSignal needs attention</b>${plan === "remind" ? " (still down)" : ""}\n${problems.map((p) => `• ${esc(p)}`).join("\n")}\n\nOpen the Status page on the website for details.`;
      for (const chat of await adminChats(sb)) if ((await tgSendDetailed(chat, text, { html: true })).ok) alerted++;
      if (!alerted && plan !== "recovered") console.error("[watchdog] problem found but no admin could be told: set ADMIN_EMAILS and link Telegram on the Account page");
      alertedAt = plan === "recovered" ? null : alerted ? new Date(now).toISOString() : alertedAt;
    }
    await sb.from("engine_config").upsert({ key: KEY, value: { checkedAt: new Date(now).toISOString(), state, problems, alertedAt }, note: "watchdog state", updated_at: new Date(now).toISOString() });
    return { checked: true, state, problems, alerted };
  } catch (e) {
    console.error(`[watchdog] ${(e as Error).message}`);
    return { checked: false, state: "ok", problems: [], alerted: 0, skipped: (e as Error).message };
  }
}

/** Pure: should this check send an alert? Exported for tests. */
export function alertPlan(prev: WatchState, state: "ok" | "down", now: number): "down" | "remind" | "recovered" | "none" {
  const was = prev.state ?? "ok";
  if (state === "down" && was !== "down") return "down";
  if (state === "down" && (!prev.alertedAt || now - Date.parse(prev.alertedAt) > REMIND_MS)) return "remind";
  if (state === "ok" && was === "down" && prev.alertedAt) return "recovered";
  return "none";
}

type Level = "ok" | "warn" | "down" | "info";
export interface HealthCheck { id: string; label: string; level: Level; detail: string; at?: string | null }

/** Ledger health for the Status page: queue, what reached nobody, decisions, follow-up failures, recent issues. */
export async function ledgerChecks(sb: SupabaseClient, now = Date.now()): Promise<HealthCheck[]> {
  const day = new Date(now - 86_400_000).toISOString();
  const out: HealthCheck[] = [];
  const pending = await sb.from("signals").select("created_at").is("processed_at", null).order("created_at", { ascending: true }).limit(1);
  if (pending.error) return [{ id: "ledger", label: "Signal ledger", level: "down", detail: "The ledger tables are missing: run supabase/stage52.sql, stage53.sql and stage54.sql in Supabase." }];
  const pendingCount = await sb.from("signals").select("id", { count: "exact", head: true }).is("processed_at", null);
  const oldest = pending.data?.[0]?.created_at as string | undefined;
  const waitMin = oldest ? Math.round((now - Date.parse(oldest)) / 60_000) : 0;
  out.push({ id: "queue", label: "Signal queue (waiting to be sent)", level: !oldest ? "ok" : waitMin > QUEUE_STUCK_MIN ? "warn" : "ok", at: oldest ?? null, detail: oldest ? `${pendingCount.count ?? 0} waiting, the oldest for ${waitMin} min.` : "Empty: every signal has been handled." });

  const [conf, confSent, confNobody, spec, sent, skipped, filtered, failed, fuFailed, issues] = await Promise.all([
    sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", day),
    sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", day).not("broadcast_at", "is", null),
    sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", day).is("broadcast_at", null).not("processed_at", "is", null),
    sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "speculative").gte("created_at", day),
    sb.from("signal_deliveries").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", day),
    sb.from("signal_deliveries").select("id", { count: "exact", head: true }).eq("status", "skipped").gte("created_at", day),
    sb.from("signal_deliveries").select("id", { count: "exact", head: true }).eq("status", "filtered").gte("created_at", day),
    sb.from("signal_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", day),
    sb.from("followup_messages").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", day),
    sb.from("signal_issues").select("created_at, stage, reason").gte("created_at", day).order("created_at", { ascending: false }).limit(3),
  ]);
  const nobody = confNobody.count ?? 0;
  out.push({ id: "confirmed24", label: "Confirmed Trades, last 24 hours", level: nobody ? "warn" : "info", detail: `${conf.count ?? 0} found, ${confSent.count ?? 0} sent to at least one member${nobody ? `, ${nobody} reached nobody (see the reasons in signal_deliveries)` : ""}. Speculative setups logged: ${spec.count ?? 0}.` });
  out.push({ id: "decisions24", label: "Delivery decisions, last 24 hours", level: (failed.count ?? 0) ? "warn" : "info", detail: `${sent.count ?? 0} sent, ${skipped.count ?? 0} skipped (exchange), ${filtered.count ?? 0} filtered (member settings), ${failed.count ?? 0} failed.` });
  if (fuFailed.error) out.push({ id: "followups24", label: "Follow-up messages", level: "warn", detail: "The follow-up log is missing: run supabase/stage54.sql." });
  else out.push({ id: "followups24", label: "Follow-up messages, last 24 hours", level: (fuFailed.count ?? 0) ? "warn" : "info", detail: (fuFailed.count ?? 0) ? `${fuFailed.count} failed to send (see followup_messages).` : "None failed." });
  const list = (issues.data ?? []) as { created_at: string; stage: string; reason: string }[];
  out.push({ id: "issues24", label: "Logged issues, last 24 hours", level: "info", at: list[0]?.created_at ?? null, detail: list.length ? list.map((i) => `${i.stage}: ${i.reason.replace(/\b\d{6,}\b/g, "[chat]")}`).join(" | ") : "None." });
  return out;
}
