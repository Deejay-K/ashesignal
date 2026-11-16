// Stage 51 - public nicknames. A nickname is the only thing about a person that other users ever see (results
// ticker, result cards). It is chosen by the user in their profile; until they choose one they appear under an
// automatic alias that reveals nothing. Emails, phone numbers, links and names that pretend to be staff are refused.

const RESERVED = /(ashe\s*signal|ashe\s*foundry|admin|official|support|moderator|\bmod\b|staff|squixi)/i;

/** A stable alias made from the account id, e.g. "Trader-7K2Q". Not reversible to the id in any useful way. */
export function autoAlias(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) { h ^= userId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const s = (h >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return `Trader-${s}`;
}

/** Returns the cleaned nickname, or an error message explaining what to change. Empty input clears it. */
export function cleanNickname(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return { ok: true, value: null };
  if (v.length < 3 || v.length > 20) return { ok: false, error: "Use 3 to 20 characters." };
  if (!/^[\p{L}\p{N} _.-]+$/u.test(v)) return { ok: false, error: "Use letters, numbers, spaces, dots, dashes or underscores only." };
  if (/@|https?:|www\.|\.(com|net|org|io|ca)\b/i.test(v)) return { ok: false, error: "No emails or links: the nickname is public." };
  if ((v.match(/\d/g) ?? []).length >= 7) return { ok: false, error: "That looks like a phone number. Pick a nickname without long numbers." };
  if (RESERVED.test(v)) return { ok: false, error: "That name is reserved. Pick another one." };
  return { ok: true, value: v };
}

/** What other users see for this person. */
export function publicName(userId: string, displayName?: string | null): string {
  const c = cleanNickname(displayName);
  return c.ok && c.value ? c.value : autoAlias(userId);
}
