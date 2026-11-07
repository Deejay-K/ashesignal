// Hybrid watchlist store.
// - Guest: localStorage only.
// - Signed in: the account (Supabase via /api/me/watchlist) is the source of truth;
//    localStorage mirrors it so the UI can render instantly. The guest list is merged
//    into the account once on sign-in (see AuthMenu).

export interface WatchItem {
  id: string; // coingecko id, or `addr:<chain>:<address>` for DEX tokens
  symbol: string;
  name: string;
  address?: string;
  chain?: string;
}

const KEY = "ashesignal.watchlist.v1";
let signedIn = false;

export function setWatchlistSignedIn(v: boolean) {
  signedIn = v;
}

export function getWatchlist(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(list: WatchItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  window.dispatchEvent(new Event("watchlist-change"));
}

export function isWatched(id: string) {
  return getWatchlist().some((w) => w.id === id);
}

export function toggleWatch(item: WatchItem): boolean {
  const list = getWatchlist();
  const idx = list.findIndex((w) => w.id === item.id);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(item);
  write(list);
  if (signedIn) {
    if (idx >= 0) fetch(`/api/me/watchlist?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => {});
    else fetch("/api/me/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [item] }) }).catch(() => {});
  }
  return idx < 0;
}

/** Pull the account's list into localStorage (call after sign-in / on page load when signed in). */
export async function syncFromAccount(): Promise<boolean> {
  try {
    const r = await fetch("/api/me/watchlist");
    if (r.status === 401 || r.status === 501) {
      signedIn = false;
      return false;
    }
    if (!r.ok) return false;
    const j = (await r.json()) as { items: WatchItem[] };
    signedIn = true;
    write(j.items);
    return true;
  } catch {
    return false;
  }
}
