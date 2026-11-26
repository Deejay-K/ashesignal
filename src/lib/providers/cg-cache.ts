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

export interface CacheTimes { freshMs: number; staleMs: number }
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const COOL_KEY = "coingecko:cooldown";
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
  const m = /try again in (\d+)/i.exec(String((e as Error)?.message ?? ""));
  const waitMs = Math.min(10 * MIN, Math.max(90_000, m ? Number(m[1]) * 1000 : 0));
  coolUntil = now + waitMs;
  await writeRow(COOL_KEY, { until: coolUntil, reason: String((e as Error)?.message ?? "429").slice(0, 200) }, now);
}

/**
 * Serve `key` from the shared cache when fresh; otherwise ask CoinGecko once. If CoinGecko refuses (429), is down,
 * or is cooling down, serve the last good answer if it is younger than staleMs; only then fail.
 */
export async function cgCached<T>(key: string, t: CacheTimes, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
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
  if (await cooling(now)) {
    const s = stale();
    if (s !== undefined) return s;
    throw new ProviderError("coingecko", 429, `cooling down after a rate limit until ${new Date(coolUntil).toISOString().slice(11, 16)} UTC, and no saved copy of this data yet`);
  }
  try {
    const v = await load();
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
export async function cgHealth(): Promise<{ coolingUntil: number | null; listAgeMin: number | null; lastError: string | null }> {
  const now = Date.now();
  const isCooling = await cooling(now);
  const list = await readRow("markets:250:false");
  return { coolingUntil: isCooling ? coolUntil : null, listAgeMin: list ? Math.round((now - list.at) / MIN) : null, lastError: lastError?.message ?? null };
}

/** Tests only: forget this server's in-memory copies, as a fresh server would. */
export function cgResetMemoryForTests(): void { mem.clear(); coolUntil = 0; }
