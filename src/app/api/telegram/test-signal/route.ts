import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { broadcastConfirmed } from "@/lib/telegram-broadcast";
import { analyzeAsset } from "@/lib/market/analyze";
import { search } from "@/lib/providers/coingecko";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the automatic confirmed-trade message for one coin to every opted-in Telegram chat, so the format can
 * be checked without waiting for a real promotion. ?secret=CRON_SECRET&symbol=SOL&tf=4h[&chat=ID] (chat limits
 * delivery to one chat id). Uses the live setup even if it is not confirmed; the message is labelled TEST.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const tf = (url.searchParams.get("tf") ?? "4h") as Timeframe;
  const hits = await search(symbol);
  const cn = hits.find((h) => h.symbol.toUpperCase() === symbol) ?? hits[0];
  if (!cn) return NextResponse.json({ error: `coin ${symbol} not found` }, { status: 404 });
  const a = await analyzeAsset({ symbol: cn.symbol.toUpperCase(), coingeckoId: cn.id }, [tf]);
  const t = a.timeframes[tf];
  if (!t || "unavailable" in t || !t.setup) return NextResponse.json({ error: `${symbol} has no setup on ${tf} right now; try another coin or timeframe` }, { status: 404 });
  const only = url.searchParams.get("chat");
  const r = await broadcastConfirmed(sb, [{ coingeckoId: cn.id, symbol: cn.symbol.toUpperCase(), name: cn.name, timeframe: tf, price: t.price, setup: t.setup, qualifies: [`TEST MESSAGE (${t.setup.kind} setup used as a sample). Real signals only go out when the engine confirms a trade.`] }], { maxMessages: 40, onlyChat: only ?? undefined, test: true });
  return NextResponse.json({ ok: true, symbol: cn.symbol.toUpperCase(), tf, kind: t.setup.kind, ...r });
}
