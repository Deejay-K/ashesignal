import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, cronAuthorized } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/engine-config";
import { aiProvider } from "@/lib/ai/claude";
import { getGlobal } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { getOhlcv } from "@/lib/market/ohlcv";
import { safe } from "@/lib/fetch";
import { ledgerChecks, runWatchdog } from "@/lib/watchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Level = "ok" | "warn" | "down" | "info";
interface Check { id: string; label: string; level: Level; detail: string; at?: string | null }

const mins = (iso?: string | null) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60_000) : null);
const ago = (m: number | null) => (m == null ? "never" : m < 1 ? "just now" : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);

/**
 * Stage 49 - owner health check: is the worker running, are signals and follow-ups flowing, do the data sources
 * and the AI answer. Admins only (ADMIN_EMAILS), or ?secret=CRON_SECRET. Reads timestamps the jobs already write;
 * nothing new is stored.
 */
export async function GET(req: NextRequest) {
  const ss = await supabaseServer();
  const email = ss ? (await ss.auth.getUser()).data.user?.email : null;
  if (!isAdminEmail(email) && !cronAuthorized(req)) return NextResponse.json({ error: "Admins only. Add your email to ADMIN_EMAILS in Vercel, or open this with ?secret=CRON_SECRET." }, { status: 401 });
  const sb = supabaseAdmin();
  const checks: Check[] = [];
  const freshness = (id: string, label: string, iso: string | null | undefined, warnMin: number, downMin: number, what: string) => {
    const m = mins(iso);
    checks.push({ id, label, at: iso ?? null, level: m == null ? "down" : m > downMin ? "down" : m > warnMin ? "warn" : "ok", detail: m == null ? `No ${what} recorded yet.` : `Last ${what}: ${ago(m)}.` });
  };
  if (!sb) checks.push({ id: "db", label: "Database", level: "down", detail: "Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)." });
  else {
    const one = async (table: string, col: string) => { const r = await sb.from(table).select(col).order(col, { ascending: false, nullsFirst: false }).limit(1); return r.error ? undefined : (((r.data?.[0] as unknown as Record<string, string> | undefined)?.[col]) ?? null); };
    const [screen, follow, lastSignal, lastChange, spot, lab, openRes, users, groups] = await Promise.all([
      one("coin_metrics", "updated_at"), one("signal_followups", "last_checked_at"), one("signal_followups", "emitted_at"), one("category_history", "changed_at"), one("spot_picks", "updated_at"), one("engine_lab", "updated_at"),
      sb.from("signal_followups").select("id", { count: "exact", head: true }).is("closed_at", null),
      sb.from("telegram_users").select("tg_user_id", { count: "exact", head: true }).eq("broadcast", true),
      sb.from("telegram_chats").select("chat_id", { count: "exact", head: true }).eq("broadcast", true),
    ]);
    checks.push({ id: "db", label: "Database", level: screen === undefined ? "down" : "ok", detail: screen === undefined ? "Could not read the screener table. Re-run supabase/schema.sql." : "Connected." });
    freshness("worker", "Worker (GitHub Actions, every 5 min)", screen ?? null, 20, 60, "screener run");
    const open = openRes.count ?? 0;
    if (open) freshness("followups", "Follow-up messages (TP, stop, cancelled)", follow ?? null, 20, 60, "check of open signals");
    else checks.push({ id: "followups", label: "Follow-up messages (TP, stop, cancelled)", level: "info", detail: "No open signals to follow right now.", at: follow ?? null });
    checks.push({ id: "signal", label: "Last Confirmed Trade sent", level: "info", at: lastSignal ?? null, detail: lastSignal ? `${ago(mins(lastSignal))}. ${open} signal${open === 1 ? "" : "s"} still being followed.` : "None sent yet." });
    checks.push({ id: "changes", label: "Last category change", level: "info", at: lastChange ?? null, detail: lastChange ? `${ago(mins(lastChange))} (a coin entered or left Confirmed or Watching).` : "None recorded yet." });
    freshness("spot", "Spot picks job", spot ?? null, 180, 1440, "spot scan");
    freshness("lab", "Engine Lab job", lab ?? null, 360, 2880, "backtest");
    checks.push({ id: "audience", label: "Telegram audience", level: (users.count ?? 0) + (groups.count ?? 0) ? "ok" : "warn", detail: `${users.count ?? 0} people and ${groups.count ?? 0} group${groups.count === 1 ? "" : "s"} have signals switched on.` });
  }
  if (sb) {
    checks.push(...(await ledgerChecks(sb).catch((e) => [{ id: "ledger", label: "Signal ledger", level: "warn" as Level, detail: `Could not read: ${(e as Error).message}` }])));
    const w = await runWatchdog(sb);
    const adminsReachable = (process.env.ADMIN_EMAILS ?? "").trim() ? "Alerts go to admins with Telegram linked." : "Set ADMIN_EMAILS in Vercel and link Telegram on the Account page to get alerts.";
    checks.push({ id: "watchdog", label: "Watchdog alerts", level: process.env.ADMIN_EMAILS ? "ok" : "warn", detail: `${w.problems.length ? `Problem: ${w.problems[0]}` : "No problem found."} ${adminsReachable}` });
  }
  checks.push({ id: "telegram", label: "Telegram bot", level: process.env.TELEGRAM_BOT_TOKEN ? "ok" : "down", detail: process.env.TELEGRAM_BOT_TOKEN ? "Bot token is set." : "TELEGRAM_BOT_TOKEN is missing in Vercel." });
  checks.push({ id: "site", label: "Site address for links and images", level: process.env.NEXT_PUBLIC_SITE_URL ? "ok" : "warn", detail: process.env.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL is set." : "NEXT_PUBLIC_SITE_URL is missing: signal cards and result cards cannot be attached." });
  const ai = aiProvider();
  checks.push({ id: "ai", label: "AI chat", level: ai === "local" ? "warn" : "ok", detail: ai === "local" ? "No AI key configured: answers come from the built-in template writer." : `Provider configured${process.env.AI_MODEL ? ` (${process.env.AI_MODEL})` : ""}. Use /api/ai/health for a live test.` });
  // Live data sources, each with a short timeout so the page always answers.
  const timed = async <T,>(p: Promise<T>) => { const t = Date.now(); const r = await Promise.race([safe(p), new Promise<{ ok: false; error: string }>((res) => setTimeout(() => res({ ok: false, error: "timed out after 8 s" }), 8000))]); return { r, ms: Date.now() - t }; };
  const [cg, fg, ex] = await Promise.all([timed(getGlobal()), timed(getFearGreed(1)), timed(getOhlcv({ symbol: "BTC", coingeckoId: "bitcoin" }, "1h", 5))]);
  checks.push({ id: "coingecko", label: "CoinGecko (prices, market data)", level: cg.r.ok ? "ok" : "down", detail: cg.r.ok ? `Answered in ${cg.ms} ms.` : `Not answering: ${(cg.r as { error: string }).error}` });
  checks.push({ id: "exchange", label: "Exchange candles (the engine's input)", level: ex.r.ok ? "ok" : "down", detail: ex.r.ok ? `BTC 1h candles from ${(ex.r as { data: { source?: string } }).data.source ?? "exchange"} in ${ex.ms} ms.` : `Not answering: ${(ex.r as { error: string }).error}. No new signals can be produced until this recovers.` });
  checks.push({ id: "feargreed", label: "Fear & Greed index", level: fg.r.ok ? "ok" : "warn", detail: fg.r.ok ? `Answered in ${fg.ms} ms.` : `Not answering: ${(fg.r as { error: string }).error}` });
  const worst: Level = checks.some((c) => c.level === "down") ? "down" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  const headline = worst === "ok" ? "Everything is running." : worst === "warn" ? "Running, with something to look at." : checks.find((c) => c.id === "worker")?.level === "down" ? "The worker is not running: no new signals or follow-ups are going out." : "Something is down.";
  return NextResponse.json({ overall: worst, headline, checks, at: new Date().toISOString() });
}
