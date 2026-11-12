// Stage 45 - one request per URL per page. Several dashboard cards need the same data (the signal list, the
// regime); before this each card fetched its own copy. sharedJson() hands every caller the same in-flight or
// recent answer for a short time, so the page asks the server once.

const cache = new Map<string, { at: number; p: Promise<unknown> }>();

export function sharedJson<T = unknown>(url: string, ttlMs = 20_000, timeoutMs = 45_000): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T | null>;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  const p = fetch(url, ctl ? { signal: ctl.signal } : undefined)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null)
    .then((v) => { if (timer) clearTimeout(timer); if (v == null) cache.delete(url); return v; });
  cache.set(url, { at: Date.now(), p });
  return p;
}
