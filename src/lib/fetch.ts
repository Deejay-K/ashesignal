// Shared HTTP layer: TTL cache, request de-duplication, per-host rate limiting,
// retry with backoff, and structured errors. Every provider goes through here.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Per-host sliding-window limiter. Numbers are conservative versions of the
 * public free-tier limits so we never trip a ban:
 *   coingecko  ~30/min without a key (demo key: 30/min, pro: much higher)
 *   binance    1200 weight/min; klines=2 weight → ~500/min, we cap far lower
 *   dexscreener 300/min for most endpoints, 60/min for token-profiles/boosts
 *   geckoterminal 30/min
 *   goplus     ~ no published hard cap, but be polite
 *   alternative.me  no published cap, data changes once a day
 */
const HOST_LIMITS: Record<string, { perMinute: number }> = {
  "api.coingecko.com": { perMinute: 25 },
  "pro-api.coingecko.com": { perMinute: 400 },
  "api.binance.com": { perMinute: 300 },
  "api1.binance.com": { perMinute: 300 },
  "data-api.binance.vision": { perMinute: 300 },
  "api.dexscreener.com": { perMinute: 250 },
  "api.geckoterminal.com": { perMinute: 25 },
  "api.gopluslabs.io": { perMinute: 30 },
  "api.alternative.me": { perMinute: 20 },
};

const hostWindows = new Map<string, number[]>();

async function acquire(host: string) {
  const limit = HOST_LIMITS[host]?.perMinute ?? 60;
  for (;;) {
    const now = Date.now();
    const win = (hostWindows.get(host) ?? []).filter((t) => now - t < 60_000);
    if (win.length < limit) {
      win.push(now);
      hostWindows.set(host, win);
      return;
    }
    const waitMs = 60_000 - (now - win[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
  }
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
  }
}

export interface FetchOpts {
  /** cache TTL in ms. 0 disables caching. */
  ttl?: number;
  headers?: Record<string, string>;
  provider: string;
  retries?: number;
  timeoutMs?: number;
}

export async function fetchJson<T>(url: string, opts: FetchOpts): Promise<T> {
  const ttl = opts.ttl ?? 30_000;
  const key = url;

  if (ttl > 0) {
    const hit = cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
  }

  const run = (async () => {
    const host = new URL(url).host;
    const retries = opts.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await acquire(host);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", ...(opts.headers ?? {}) },
          signal: ctrl.signal,
          cache: "no-store",
        });
        clearTimeout(t);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ProviderError(opts.provider, res.status, `HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
        if (!res.ok) {
          throw new ProviderError(opts.provider, res.status, `HTTP ${res.status} for ${url}`);
        }
        const json = (await res.json()) as T;
        if (ttl > 0) cache.set(key, { value: json, expiresAt: Date.now() + ttl });
        return json;
      } catch (e) {
        clearTimeout(t);
        if (e instanceof ProviderError && e.status !== null && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    if (lastErr instanceof ProviderError) throw lastErr;
    throw new ProviderError(opts.provider, null, (lastErr as Error)?.message ?? "request failed");
  })();

  if (ttl > 0) {
    inflight.set(key, run);
    run.finally(() => inflight.delete(key));
  }
  return run;
}

/** Wrap a provider call so a failure degrades to null instead of crashing the page. */
export async function safe<T>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("provider failure:", msg);
    return { ok: false, error: msg };
  }
}

export function cacheStats() {
  return { entries: cache.size, inflight: inflight.size };
}
