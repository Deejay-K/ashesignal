// Stage 55 - one-look diagnosis of the live signal pipeline, from the bot token to the last message sent.
// Read-only: it never sends, changes or deletes anything. Secrets are never included in the result.

import type { SupabaseClient } from "@supabase/supabase-js";

const DAY = 86_400_000;
const mask = (s: string) => s.replace(/\b\d{6,}\b/g, "[chat]");

/** Which database updates are applied, by probing one table or column from each. */
export async function schemaStatus(sb: SupabaseClient): Promise<Record<string, boolean>> {
  const probe = async (table: string, cols: string) => !(await sb.from(table).select(cols).limit(1)).error;
  const [s49, s52a, s52b, s52c, s52d, s54a, s54b, s54c, s55] = await Promise.all([
    probe("telegram_users", "sig_filters"),
    probe("signals", "id, broadcast_at, processed_at"),
    probe("signal_deliveries", "id, status, reason"),
    probe("signal_outcomes", "signal_id"),
    probe("signal_followups", "signal_id"),
    probe("followup_messages", "id"),
    probe("signal_claims", "signal_id"),
    probe("telegram_users", "utc_offset, spec_watchlist, spec_custom"),
    probe("telegram_chats", "spec_preset"),
  ]);
  return { "stage49 (signal filters)": s49, "stage52 (signal ledger)": s52a && s52b && s52c && s52d, "stage54 (follow-up log, send guard, member settings)": s54a && s54b && s54c, "stage55 (group speculative alerts, optional)": s55 };
}

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const r = await q;
  return r.error ? null : r.count ?? 0;
}

export async function diagnose(sb: SupabaseClient, now = Date.now()) {
  const problems: string[] = [];
  const good: string[] = [];
  const since = new Date(now - DAY).toISOString();

  // 1. Telegram: is the bot token accepted, and is the webhook healthy?
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const telegram: Record<string, unknown> = { tokenSet: !!token };
  if (!token) problems.push("TELEGRAM_BOT_TOKEN is not set in Vercel: nothing can be sent.");
  else {
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(8_000) })).json();
      telegram.botOk = !!me.ok; telegram.bot = me.ok ? `@${me.result?.username}` : me.description;
      if (!me.ok) problems.push(`Telegram rejects the bot token (${me.description}). Copy the token from @BotFather into TELEGRAM_BOT_TOKEN in Vercel and redeploy.`);
      const wh = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: "no-store", signal: AbortSignal.timeout(8_000) })).json();
      if (wh.ok) {
        const w = wh.result ?? {};
        telegram.webhook = w.url ? String(w.url).replace(/\?.*$/, "?…") : "(none)";
        telegram.pendingUpdates = w.pending_update_count ?? 0;
        if (w.last_error_message) telegram.lastWebhookError = `${w.last_error_message} (${w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : "?"})`;
        if (!w.url) problems.push("No Telegram webhook is set, so the bot cannot answer commands. Open /api/telegram/setup?secret=YOUR_CRON_SECRET once.");
      }
    } catch (e) { telegram.error = (e as Error).message; problems.push(`Could not reach Telegram: ${(e as Error).message}`); }
  }

  // 2. Database updates.
  const schema = await schemaStatus(sb);
  if (!schema["stage52 (signal ledger)"]) problems.push("stage52.sql is not applied. The screener then sends Confirmed Trades directly (the stage 51 way; see the \"telegram\" line of the \"Screener metrics\" step in GitHub Actions), but nothing is recorded, so the recap, the Track record headline and speculative alerts stay empty. Run supabase/stage52.sql, then stage53.sql and stage54.sql, in the Supabase SQL editor.");
  else if (!schema["stage54 (follow-up log, send guard, member settings)"]) problems.push("stage54.sql is not applied. Signals still go out, but follow-up messages are not logged and the /specalerts member settings cannot be saved. Run supabase/stage54.sql in the Supabase SQL editor.");
  else good.push("Database updates 52 to 54 are applied.");
  const ledger = schema["stage52 (signal ledger)"];

  // 3. Who receives signals.
  const users = await count(sb.from("telegram_users").select("tg_user_id", { count: "exact", head: true }).eq("broadcast", true));
  const groups = await count(sb.from("telegram_chats").select("chat_id", { count: "exact", head: true }).eq("broadcast", true));
  const specUsers = ledger ? await count(sb.from("telegram_users").select("tg_user_id", { count: "exact", head: true }).eq("broadcast", true).neq("spec_preset", "off")) : null;
  const specGroups = schema["stage55 (group speculative alerts, optional)"] ? await count(sb.from("telegram_chats").select("chat_id", { count: "exact", head: true }).eq("broadcast", true).neq("spec_preset", "off")) : null;
  const recipients = { membersWithSignalsOn: users, groupsWithSignalsOn: groups, speculativeMembers: specUsers, speculativeGroups: specGroups };
  if (users == null || groups == null) problems.push("Could not read the Telegram member or group lists from the database.");
  else {
    if (groups === 0) problems.push("No group chat has signals switched on. In the group, send /signals on (or press Turn on on the signals screen).");
    if (users === 0 && groups === 0) problems.push("Nobody has signals switched on, so every Confirmed Trade reaches nobody.");
  }
  if (ledger && specUsers === 0 && !specGroups) problems.push("Nobody has speculative alerts on (they are off by default). Send /specalerts in a private chat, or in the group once stage55.sql is applied, and pick a preset.");

  // 4. The worker.
  const { data: lastScreen } = await sb.from("coin_metrics").select("updated_at").order("updated_at", { ascending: false }).limit(1);
  const screenAt = lastScreen?.[0]?.updated_at as string | undefined;
  const screenMin = screenAt ? Math.round((now - Date.parse(screenAt)) / 60_000) : null;
  const worker = { lastScreenerRun: screenAt ?? null, minutesAgo: screenMin };
  if (screenMin == null || screenMin > 30) problems.push(`The 5-minute worker has not run for ${screenMin ?? "ever"} minutes. In GitHub: Actions, AsheSignal worker, check for a disabled banner or red runs, then press Run workflow.`);
  else good.push(`The worker ran ${screenMin} min ago.`);

  // 5. The last 24 hours: found, queued, sent.
  const found = await count(sb.from("category_history").select("id", { count: "exact", head: true }).eq("category", "confirmed").gte("changed_at", since));
  const last24: Record<string, unknown> = { confirmedFound: found };
  let topReasons: { reason: string; count: number }[] = [];
  let recentIssues: string[] = [];
  if (ledger) {
    const [confQ, confSent, confNobody, confPending, specQ, specSent] = await Promise.all([
      count(sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", since)),
      count(sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", since).not("broadcast_at", "is", null)),
      count(sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "confirmed").gte("created_at", since).is("broadcast_at", null).not("processed_at", "is", null)),
      count(sb.from("signals").select("id", { count: "exact", head: true }).is("processed_at", null).lt("created_at", new Date(now - 20 * 60_000).toISOString())),
      count(sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "speculative").gte("created_at", since)),
      count(sb.from("signals").select("id", { count: "exact", head: true }).eq("kind", "speculative").gte("created_at", since).not("broadcast_at", "is", null)),
    ]);
    Object.assign(last24, { confirmedQueued: confQ, confirmedSent: confSent, confirmedReachedNobody: confNobody, waitingOver20Min: confPending, speculativeLogged: specQ, speculativeSent: specSent });
    if ((found ?? 0) > 0 && confQ === 0) problems.push(`${found} Confirmed Trades were found in 24 h but none were queued. Open the latest GitHub Actions run, step "Screener metrics", and read the "warning" line.`);
    if ((confPending ?? 0) > 0) problems.push(`${confPending} signals have waited more than 20 minutes to be sent. Check the "Deliver queued signals" step in GitHub Actions (it prints the error and HTTP code).`);
    if ((confNobody ?? 0) > 0) problems.push(`${confNobody} Confirmed Trades in 24 h reached nobody. The reasons are listed under topReasons.`);
    if ((confSent ?? 0) > 0) good.push(`${confSent} Confirmed Trades were sent in the last 24 h.`);
    if (specQ === 0 && (confQ ?? 0) > 0) good.push("No speculative setups were logged in 24 h while Confirmed Trades were: the engine found none on the coins it scans.");
    const { data: reasons } = await sb.from("signal_deliveries").select("status, reason").neq("status", "sent").gte("created_at", since).limit(1000);
    const tally = new Map<string, number>();
    for (const r of reasons ?? []) { const k = `${r.status}: ${mask(String(r.reason))}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    topReasons = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, n]) => ({ reason, count: n }));
    const { data: groupIds } = await sb.from("telegram_chats").select("chat_id").eq("broadcast", true).limit(50);
    if ((confSent ?? 0) > 0 && groupIds?.length) {
      const gs = await count(sb.from("signal_deliveries").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", since).in("recipient", groupIds.map((g: { chat_id: string | number }) => String(g.chat_id))));
      last24.sentToGroups = gs;
      if (gs === 0) problems.push("Confirmed Trades went out in 24 h, but none to a group chat. Check the group's filters (/signals in the group), that the bot is still a member and allowed to post; topReasons shows why each one was held back.");
    }
    const { data: iss } = await sb.from("signal_issues").select("created_at, stage, reason").gte("created_at", since).order("created_at", { ascending: false }).limit(10);
    recentIssues = (iss ?? []).map((i: { created_at: string; stage: string; reason: string }) => `${i.created_at.slice(0, 16)} ${i.stage}: ${mask(i.reason)}`);
  }

  return { at: new Date(now).toISOString(), verdict: problems.length ? problems : ["No problem found."], working: good, telegram, schema, recipients, worker, last24h: last24, topReasons, recentIssues };
}
