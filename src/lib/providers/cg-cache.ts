// Stage 56 - one CoinGecko cache shared by every job, every run and every visitor.
//
// The worker runs every 5 minutes and each step used to download its own copy of the same CoinGecko data, which
// blew through CoinGecko's free limits (about 30 calls a minute, 10,000 a month) and turned every step into a
// "HTTP 429". Now:
//   1. Each answer is stored in the database (api_cache) and reused while fresh, by any step on any server.
//   2. After a 429, nobody calls CoinGecko again until the cool-down ends (shared through the same table).
//   3. When CoinGecko refuses or is down, the last good answer is used (within a stale limit) instead of failing.
// Without the api_cache table (stage56.sql not run) it falls back to the old in-memory behaviour.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ProviderError } from "@/lib/fetch";

export interface CacheTimes {
  freshMs: number; staleMs: number;
  /** The screener's coin list: the last thing allowed to call CoinGecko when the monthly budget runs low. */
  essential?: boolean;
}
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const COOL_KEY = "coingecko:cooldown";

// ---------- Monthly budget guard ----------
// CoinGecko's free Demo key allows 10,000 calls a month (it refills on the 1st). The app keeps its own budget below
// that (CG_MONTHLY_BUDGET, default 8,000) and paces itself through the month:
//   normal  - on pace: refresh times as set
//   saver   - ahead of pace for the day of the month: refresh 3 times less often
//   reserve - 90% of the budget used: only the screener's coin list may still call (6 times less often)
//   stop    - budget used: no calls at all until the 1st; saved data is used
export type BudgetMode = "normal" | "saver" | "reserve" | "stop";
export const MONTHLY_BUDGET = Math.max(500, Number(process.env.CG_MONTHLY_BUDGET ?? 8000) || 8000);
const monthKey = (now: number) => `coingecko:usage:${new Date(now).toISOString().slice(0, 7)}`;

/** Pure: which mode a month is in, from calls used so far, the budget and the date (UTC, month resets on the 1st). */
export function budgetMode(used: number, budget: number, now: number): BudgetMode {
  if (used >= budget) return "stop";
  if (used >= budget * 0.9) return "reserve";
  const d = new Date(now);
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (d.getUTCDate() - 1 + (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440) / days;
  // A small head start (3% of the budget) so the first hours of a month are not "ahead of pace" by one call.
  return used > budget * Math.max(elapsed, 0.03) ? "saver" : "normal";
}

let usageMem: { key: string; used: number; at: number } | null = null;
async function monthUsage(now: number): Promise<number> {
  const key = monthKey(now);
  if (usageMem && usageMem.key === key && now - usageMem.at < 30_000) return usageMem.used;
  const row = await readRow(key);
  const used = Number((row?.value as { calls?: number } | undefined)?.calls ?? 0);
  usageMem = { key, used, at: now };
  return used;
}
async function countCall(now: number): Promise<void> {
  const key = monthKey(now);
  const sb = supabaseAdmin();
  if (usageMem?.key === key) usageMem.used++;
  if (!sb) return;
  // Atomic increment when stage56.sql is applied; otherwise a best-effort read and write.
  const r = await sb.rpc("cg_count_call", { k: key });
  if (!r.error) { usageMem = { key, used: Number(r.data ?? 0), at: now }; return; }
  const used = (await monthUsage(now)) + 1;
  await writeRow(key, { calls: used }, now);
}
const mem = new Map<string, { at: number; v: unknown }>();
let coolUntil = 0;
let lastError: { at: number; message: string } | null = null;

const is429 = (e: unknown) => e instanceof ProviderError && e.status === 429 || /\b429\b/.test(String((e as Error)?.message ?? ""));

async function readRow(key: string): Promise<{ value: unknown; at: number } | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.from("api_cache").select("value, fetched_at").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return { value: data.value, at: Date.parse(data.fetched_at) };
}

async function writeRow(key: string, value: unknown, at: number): Promise<void> {
  const sb = supabaseAdmin();
  if (!sb) return;
  await sb.from("api_cache").upsert({ key, value, fetched_at: new Date(at).toISOString() }).then(() => null, () => null);
}

/** True while CoinGecko asked us to slow down (this server, or any other step that saw the 429). */
async function cooling(now: number): Promise<boolean> {
  if (now < coolUntil) return true;
  const row = await readRow(COOL_KEY);
  const until = Number((row?.value as { until?: number } | undefined)?.until ?? 0);
  if (until > now) { coolUntil = until; return true; }
  return false;
}

async function startCooldown(now: number, e: unknown): Promise<void> {
  // Each refusal in a row doubles the wait (90 s, 3 min, 6 min ... up to 6 h): refused calls can still be counted
  // by CoinGecko, so knocking every few minutes for days (monthly limit used up) would only make it worse.
  const prev = await readRow(COOL_KEY);
  const streak = Number((prev?.value as { streak?: number } | undefined)?.streak ?? 0) + 1;
  const m = /try again in (\d+)/i.exec(String((e as Error)?.message ?? ""));
  const waitMs = Math.min(6 * HOUR, Math.max(90_000 * 2 ** (streak - 1), m ? Number(m[1]) * 1000 : 0));
  coolUntil = now + waitMs;
  await writeRow(COOL_KEY, { until: coolUntil, streak, reason: String((e as Error)?.message ?? "429").slice(0, 200) }, now);
}

/**
 * Serve `key` from the shared cache when fresh; otherwise ask CoinGecko once. If CoinGecko refuses (429), is down,
 * or is cooling down, serve the last good answer if it is younger than staleMs; only then fail.
 */
export async function cgCached<T>(key: string, t0: CacheTimes, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const mode = budgetMode(await monthUsage(now), MONTHLY_BUDGET, now);
  const t: CacheTimes = mode === "saver" ? { ...t0, freshMs: t0.freshMs * 3 } : mode === "reserve" ? { ...t0, freshMs: t0.freshMs * 6 } : t0;
  const m = mem.get(key);
  if (m && now - m.at < t.freshMs) return m.v as T;
  const row = await readRow(key);
  const age = row ? now - row.at : Infinity;
  if (row && age < t.freshMs) { mem.set(key, { at: row.at, v: row.value }); return row.value as T; }
  const stale = () => {
    if (row && age < t.staleMs) { mem.set(key, { at: now - t.freshMs + MIN, v: row.value }); return row.value as T; } // reuse for a minute before asking again
    if (m && now - m.at < t.staleMs) return m.v as T;
    return undefined;
  };
  const budgetBlocked = mode === "stop" || (mode === "reserve" && !t.essential);
  if (budgetBlocked || await cooling(now)) {
    const s = stale();
    if (s !== undefined) return s;
    throw new ProviderError("coingecko", 429, budgetBlocked
      ? `monthly CoinGecko budget ${mode === "stop" ? "used up" : "nearly used up"} (${MONTHLY_BUDGET} calls), and no saved copy of this data yet; calls resume on the 1st`
      : `cooling down after a rate limit until ${new Date(coolUntil).toISOString().slice(11, 16)} UTC, and no saved copy of this data yet`);
  }
  try {
    await countCall(now);
    const v = await load();
    const cool = await readRow(COOL_KEY);
    if (Number((cool?.value as { streak?: number } | undefined)?.streak ?? 0) > 0) { coolUntil = 0; await writeRow(COOL_KEY, { until: 0, streak: 0 }, now); } // a success resets the back-off
    mem.set(key, { at: now, v });
    await writeRow(key, v, now);
    return v;
  } catch (e) {
    lastError = { at: now, message: String((e as Error)?.message ?? e).slice(0, 200) };
    if (is429(e)) await startCooldown(now, e);
    const s = stale();
    if (s !== undefined) { console.warn(`[coingecko] ${key}: using saved data from ${Math.round(age / MIN)} min ago (${lastError.message})`); return s; }
    throw e;
  }
}

/** For the Status page: is CoinGecko cooling down, how old is the saved coin list, what was the last error. */
export async function cgHealth(): Promise<{ coolingUntil: number | null; listAgeMin: number | null; lastError: string | null; usedThisMonth: number; budget: number; mode: BudgetMode }> {
  const now = Date.now();
  const isCooling = await cooling(now);
  const list = await readRow("markets:250:false");
  const used = await monthUsage(now);
  return { coolingUntil: isCooling ? coolUntil : null, listAgeMin: list ? Math.round((now - list.at) / MIN) : null, lastError: lastError?.message ?? null, usedThisMonth: used, budget: MONTHLY_BUDGET, mode: budgetMode(used, MONTHLY_BUDGET, now) };
}

/** Tests only: forget this server's in-memory copies, as a fresh server would. */
export function cgResetMemoryForTests(): void { mem.clear(); coolUntil = 0; }
