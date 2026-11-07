// Guest-mode watchlist: localStorage only. When a user signs in (Stage 2,
// Supabase), the same shape syncs to the `watchlist_items` table.

export interface WatchItem {
  id: string; // coingecko id, or `addr:<chain>:<address>` for DEX tokens
  symbol: string;
  name: string;
  address?: string;
  chain?: string;
}

const KEY = "ashesignal.watchlist.v1";

export function getWatchlist(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function isWatched(id: string) {
  return getWatchlist().some((w) => w.id === id);
}

export function toggleWatch(item: WatchItem): boolean {
  const list = getWatchlist();
  const idx = list.findIndex((w) => w.id === item.id);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(item);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  window.dispatchEvent(new Event("watchlist-change"));
  return idx < 0;
}
