import { NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets } from "@/lib/providers/coingecko";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TFS: Timeframe[] = ["1h", "4h", "1d"];

/**
 * Runs the engine on the top-30 Binance-listed coins and logs every emitted setup to
 * signal_log (once per asset/timeframe/side until that one resolves). This is what the
 * public /performance page measures - the engine grading itself on real outcomes.
 *
 * Batched so each request stays well inside serverless time limits:
 *   ?batch=0..3  → coins 0-7, 8-15, 16-23, 24-29 (default: picks the batch from the current minute)
 *   ?all=1       → every coin in one request (only on a plan with long function timeouts)
 */
export async function GET(req: Request) {
  await ensureEngineConfig();
  try {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const top = await safe(getMarkets(1, 60, false));
  if (!top.ok) return NextResponse.json({ error: top.error }, { status: 502 });
  const url = new URL(req.url);
  const EXCL = /^(USDT|USDC|DAI|FDUSD|TUSD|PYUSD|USDE|USDS|WBTC|WETH|STETH|WSTETH|CBBTC|RETH|WEETH|WBETH|XAUT|PAXG|USD1|RLUSD)$/i;
  const allCoins = top.data.filter((c) => !EXCL.test(c.symbol)).slice(0, 30); // exchange-independent: candles from whichever CEX lists the coin
  const BATCH = 8;
  const batches = Math.ceil(allCoins.length / BATCH);
  const batchParam = url.searchParams.get("batch");
  const batch = url.searchParams.get("all") ? -1 : batchParam != null ? Number(batchParam) % batches : Math.floor(new Date().getMinutes() / 5) % batches;
  const coins = batch < 0 ? allCoins : allCoins.slice(batch * BATCH, batch * BATCH + BATCH);
  const { data: open } = await sb.from("signal_log").select("asset_key, timeframe, side").is("outcome_at", null);
  const openSet = new Set((open ?? []).map((o) => `${o.asset_key}|${o.timeframe}|${o.side}`));
  let logged = 0;
  const rows: Record<string, unknown>[] = [];
  await Promise.all(
    coins.map(async (c) => {
      const ks = await Promise.all(TFS.map((tf) => safe(getOhlcv({ symbol: c.symbol, coingeckoId: c.id }, tf, 300))));
      const analyses = ks.map((k, i) => (k.ok && k.data.quality === "verified" && k.data.candles.length ? analyzeTimeframe(TFS[i], k.data.candles) : null));
      ks.forEach((k, i) => {
        if (!k.ok || k.data.quality !== "verified") return;
        const tf = TFS[i];
        const a = analyses[i];
        if (!a?.setup || a.setup.kind === "watch") return;
        const htf = analyses[i + 1];
        const htfAligned = htf ? !(a.setup.side === "LONG" ? htf.trend.direction === "down" || htf.score <= -15 : htf.trend.direction === "up" || htf.score >= 15) : null;
        const key = `cg:${c.id}|${tf}|${a.setup.side}`;
        if (openSet.has(key)) return;
        openSet.add(key);
        const s = a.setup;
        rows.push({ engine_version: 2, htf_aligned: htfAligned, venue: k.data.source, asset_key: `cg:${c.id}`, symbol: c.symbol, timeframe: tf, side: s.side, kind: s.kind, entry: s.entry.mid, tp1: s.takeProfits[0]?.price, tp2: s.takeProfits[1]?.price, tp3: s.takeProfits[2]?.price, sl1: s.stopLosses[0]?.price, score: a.score, confidence: s.confidence });
      });
    }),
  );
  if (rows.length) {
    const { error } = await sb.from("signal_log").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    logged = rows.length;
  }
  return NextResponse.json({ ok: true, batch: batch < 0 ? "all" : `${batch + 1}/${batches}`, coins: coins.map((c) => c.symbol), logged, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
