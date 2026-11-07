// Active exchange preference: cookie (read by API routes and server pages) + localStorage + profile sync.
// Works for guests and signed-in users alike.

import { DEFAULT_VENUE, isVenueId, type VenueId } from "./venues";

export const VENUE_COOKIE = "as_venue";
export const VENUE_EVENT = "venue-change";

/** Server side: read the active venue from a request (query param wins, then cookie). */
export function venueFromRequest(req: { nextUrl?: { searchParams: URLSearchParams }; headers: Headers; url?: string }): VenueId {
  const q = req.nextUrl?.searchParams.get("venue") ?? (req.url ? new URL(req.url).searchParams.get("venue") : null);
  if (isVenueId(q)) return q;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${VENUE_COOKIE}=([a-z]+)`));
  return m && isVenueId(m[1]) ? m[1] : DEFAULT_VENUE;
}

/** Client side: current venue (cookie first, then localStorage). */
export function currentVenue(): VenueId {
  if (typeof document === "undefined") return DEFAULT_VENUE;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${VENUE_COOKIE}=([a-z]+)`));
  if (m && isVenueId(m[1])) return m[1];
  try { const v = localStorage.getItem(VENUE_COOKIE); if (isVenueId(v)) return v; } catch {}
  return DEFAULT_VENUE;
}

/** Client side: switch venue everywhere (cookie for the server, storage for guests, event for mounted components). */
export function setVenue(v: VenueId) {
  if (typeof document === "undefined") return;
  document.cookie = `${VENUE_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  try { localStorage.setItem(VENUE_COOKIE, v); } catch {}
  window.dispatchEvent(new CustomEvent(VENUE_EVENT, { detail: v }));
}
