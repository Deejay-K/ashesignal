import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets } from "@/lib/providers/coingecko";
import { getKlines, getTradingSymbols } from "@/lib/providers/binance";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TFS: Timeframe[] = ["1h", "4h", "1d"];

/**
 * Runs the engine on the top-30 Binance-listed coins and logs every emitted setup to
 * signal_log (once per asset/timeframe/side until that one resolves). This is what the
 * public /performance page measures — the engine grading itself on real outcomes.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const top = await safe(getMarkets(1, 60, false));
  if (!top.ok) return NextResponse.json({ error: top.error }, { status: 502 });
  const syms = await getTradingSymbols();
  const coins = top.data.filter((c) => syms.has(`${c.symbol}USDT`)).slice(0, 30);
  const { data: open } = await sb.from("signal_log").select("asset_key, timeframe, side").is("outcome_at", null);
  const openSet = new Set((open ?? []).map((o) => `${o.asset_key}|${o.timeframe}|${o.side}`));
  let logged = 0;
  for (const c of coins) {
    for (const tf of TFS) {
      const k = await safe(getKlines(`${c.symbol}USDT`, tf, 400));
      if (!k.ok) continue;
      const a = analyzeTimeframe(tf, k.data);
      if (!a?.setup) continue;
      const key = `cg:${c.id}|${tf}|${a.setup.side}`;
      if (openSet.has(key)) continue;
      const s = a.setup;
      await sb.from("signal_log").insert({ asset_key: `cg:${c.id}`, symbol: c.symbol, timeframe: tf, side: s.side, kind: s.kind, entry: s.entry.mid, tp1: s.takeProfits[0]?.price, tp2: s.takeProfits[1]?.price, tp3: s.takeProfits[2]?.price, sl1: s.stopLosses[0]?.price, score: a.score, confidence: s.confidence });
      openSet.add(key);
      logged++;
    }
  }
  return NextResponse.json({ ok: true, coins: coins.length, logged, at: new Date().toISOString() });
}
