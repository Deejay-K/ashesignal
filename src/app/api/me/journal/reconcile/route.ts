import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { ADAPTERS } from "@/lib/exchanges";
import { decrypt, EXCHANGE_KEYS_ENABLED } from "@/lib/exchanges/crypto";
import type { ExchangeFill, ExchangeId } from "@/lib/exchanges/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface Suggestion {
  setupId: string; symbol: string; side: "LONG" | "SHORT"; exchange: string;
  kind: "fill" | "exit";
  price: number; units: number; usd: number; fees: number; fills: number; from: string; to: string;
  note: string;
}

/**
 * Proposes journal updates from real exchange fills (read-only keys). For each open journal trade:
 *  - "fill": buys (LONG) / sells (SHORT) of the same asset on the same exchange within 12 h after it was taken
 *            -> volume-weighted fill price and total size
 *  - "exit": the opposite side after the fill -> volume-weighted exit price
 * Nothing is written here; the client shows the suggestions and PATCHes the ones the user accepts.
 */
export async function GET() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "accounts disabled" }, { status: 501 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!EXCHANGE_KEYS_ENABLED()) return NextResponse.json({ suggestions: [], note: "Exchange connections are not enabled on this server." });
  const [{ data: accounts }, { data: trades }] = await Promise.all([
    sb.from("exchange_accounts").select("*").eq("user_id", auth.user.id),
    sb.from("saved_setups").select("*").eq("user_id", auth.user.id).eq("taken", true).is("exit_price", null).order("taken_at", { ascending: false }).limit(50),
  ]);
  if (!accounts?.length) return NextResponse.json({ suggestions: [], note: "No exchange connected. Connect a read-only key on the Account page first." });
  if (!trades?.length) return NextResponse.json({ suggestions: [], note: "No open journal trades to match." });

  const fillsByExchange = new Map<string, ExchangeFill[]>();
  const errors: string[] = [];
  for (const acc of accounts) {
    try {
      const ad = ADAPTERS[acc.exchange as ExchangeId];
      const f = await ad.fills({ key: decrypt(acc.enc_key), secret: decrypt(acc.enc_secret), passphrase: acc.enc_passphrase ? decrypt(acc.enc_passphrase) : undefined }, { limit: 500 });
      fillsByExchange.set(acc.exchange, [...(fillsByExchange.get(acc.exchange) ?? []), ...f]);
    } catch (e) { errors.push(`${acc.exchange}: ${(e as Error).message}`); }
  }
  const vwap = (fs: ExchangeFill[]) => { const units = fs.reduce((s, f) => s + f.amount, 0); const usd = fs.reduce((s, f) => s + f.amount * f.price, 0); return { units, usd, price: units ? usd / units : 0, fees: fs.reduce((s, f) => s + (f.fee || 0), 0) }; };
  const suggestions: Suggestion[] = [];
  for (const t of trades) {
    const fs = fillsByExchange.get(t.exchange ?? "") ?? [];
    const taken = Date.parse(t.taken_at ?? t.created_at);
    const mine = fs.filter((f) => f.base.toUpperCase() === String(t.symbol).toUpperCase() && Date.parse(f.time) >= taken - 60 * 60_000).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (!mine.length) continue;
    const entrySide = t.side === "LONG" ? "buy" : "sell";
    const entries = mine.filter((f) => f.side === entrySide && Date.parse(f.time) <= taken + 12 * 3600_000);
    if (entries.length) {
      const v = vwap(entries);
      const differs = !t.fill_price || Math.abs(v.price - Number(t.fill_price)) / v.price > 0.001 || !t.size_units || Math.abs(v.units - Number(t.size_units)) / v.units > 0.01;
      if (differs) suggestions.push({ setupId: t.id, symbol: t.symbol, side: t.side, exchange: t.exchange, kind: "fill", price: v.price, units: v.units, usd: v.usd, fees: v.fees, fills: entries.length, from: entries[0].time, to: entries[entries.length - 1].time, note: t.fill_price ? `Journal says ${t.fill_price} x ${t.size_units ?? "?"}; exchange shows ${entries.length} fill${entries.length > 1 ? "s" : ""}.` : `${entries.length} ${entrySide} fill${entries.length > 1 ? "s" : ""} found after you recorded the trade.` });
    }
    const firstEntry = entries[0] ? Date.parse(entries[0].time) : taken;
    const exits = mine.filter((f) => f.side !== entrySide && Date.parse(f.time) > firstEntry);
    if (exits.length) {
      const v = vwap(exits);
      suggestions.push({ setupId: t.id, symbol: t.symbol, side: t.side, exchange: t.exchange, kind: "exit", price: v.price, units: v.units, usd: v.usd, fees: v.fees, fills: exits.length, from: exits[0].time, to: exits[exits.length - 1].time, note: `${exits.length} ${entrySide === "buy" ? "sell" : "buy"} fill${exits.length > 1 ? "s" : ""} after entry: looks like the exit${t.size_units && v.units < Number(t.size_units) * 0.95 ? ` (partial: ${Math.round((v.units / Number(t.size_units)) * 100)}% of the size)` : ""}.` });
    }
  }
  return NextResponse.json({ suggestions, errors, checked: trades.length });
}
