import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { publicName } from "@/lib/nickname";

export const dynamic = "force-dynamic";

export interface TickerItem { name: string; symbol: string; side: "LONG" | "SHORT"; tf: string; pct: number; r: number | null; win: boolean; at: string }

let memo: { at: number; items: TickerItem[] } | null = null;

/**
 * Stage 51 - the public results ticker: members' closed trades, wins and losses alike, newest first.
 * Shows only a nickname (or an automatic alias), the coin, direction, timeframe and the percent result. Never an
 * email, an amount of money or a position size. Paper trades are left out. A member can hide their trades in
 * their profile. Results are what members logged in their own journal.
 */
export async function GET() {
  if (memo && Date.now() - memo.at < 60_000) return NextResponse.json({ items: memo.items });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ items: [] });
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: rows } = await sb.from("saved_setups").select("user_id, symbol, side, timeframe, entry_low, entry_high, fill_price, exit_price, exit_at, realized_r, paper").eq("taken", true).not("exit_price", "is", null).gte("exit_at", since).order("exit_at", { ascending: false }).limit(120);
  const real = (rows ?? []).filter((r) => !r.paper);
  const ids = [...new Set(real.map((r) => r.user_id as string))];
  const { data: profs } = ids.length ? await sb.from("profiles").select("id, display_name, preferences").in("id", ids) : { data: [] };
  const prof = new Map((profs ?? []).map((p) => [p.id as string, p]));
  const items: TickerItem[] = [];
  const perUser = new Map<string, number>();
  for (const r of real) {
    const p = prof.get(r.user_id as string);
    if ((p?.preferences as { tickerHidden?: boolean } | null)?.tickerHidden) continue;
    const fill = Number(r.fill_price ?? (Number(r.entry_low) + Number(r.entry_high)) / 2), exit = Number(r.exit_price);
    if (!(fill > 0) || !(exit > 0)) continue;
    const pct = ((r.side === "SHORT" ? fill - exit : exit - fill) / fill) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) > 300) continue; // typo guard: nobody's spot trade moved 300%
    // One busy member must not fill the whole strip.
    const n = perUser.get(r.user_id as string) ?? 0; if (n >= 4) continue; perUser.set(r.user_id as string, n + 1);
    items.push({ name: publicName(r.user_id as string, p?.display_name as string | null), symbol: String(r.symbol).toUpperCase().slice(0, 10), side: r.side === "SHORT" ? "SHORT" : "LONG", tf: String(r.timeframe), pct: Math.round(pct * 10) / 10, r: r.realized_r != null ? Math.round(Number(r.realized_r) * 10) / 10 : null, win: pct >= 0, at: r.exit_at as string });
    if (items.length >= 30) break;
  }
  memo = { at: Date.now(), items };
  return NextResponse.json({ items });
}
