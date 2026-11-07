import { NextRequest, NextResponse } from "next/server";
import { analyzeAsset } from "@/lib/market/analyze";
import { getCoin } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { generateBriefing } from "@/lib/ai/briefing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { safe } from "@/lib/fetch";
import { SUPABASE_ENABLED } from "@/lib/supabase/env";
import { scanAddress } from "@/lib/market/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 15 * 60_000; // reuse a briefing younger than this unless ?force=1
const memCache = new Map<string, { at: number; body: unknown }>();

/**
 * GET ?id=<coingecko id>  or  ?address=<contract>   [&force=1]
 * Returns { briefing, createdAt, cached, history[] }.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const address = sp.get("address");
  const force = sp.get("force") === "1";
  const peek = sp.get("peek") === "1";
  if (!id && !address) return NextResponse.json({ error: "id or address required" }, { status: 400 });
  const assetKey = id ? `cg:${id}` : `addr:${address}`;

  const admin = supabaseAdmin();
  // 1) fresh enough? (DB first, then process memory)
  if (!force) {
    const m = memCache.get(assetKey);
    if (m && Date.now() - m.at < FRESH_MS) return NextResponse.json({ ...(m.body as object), cached: true });
    if (admin) {
      const { data } = await admin.from("ai_briefings").select("*").eq("asset_key", assetKey).order("created_at", { ascending: false }).limit(6);
      const latest = data?.[0];
      if (latest && Date.now() - new Date(latest.created_at).getTime() < FRESH_MS) {
        return NextResponse.json({ briefing: latest.briefing, createdAt: latest.created_at, price: latest.price, model: latest.model, cached: true, history: (data ?? []).slice(1).map(h => ({ id: h.id, createdAt: h.created_at, price: h.price, headline: h.briefing.headline, bottomLine: h.briefing.bottomLine, suitability: h.briefing.suitability, confidence: h.briefing.confidence })) });
      }
    }
  }

  if (peek) return NextResponse.json({ cached: false }, { status: 200 });
  if (SUPABASE_ENABLED) {
    const sb = await supabaseServer();
    const user = sb ? (await sb.auth.getUser()).data.user : null;
    if (!user) return NextResponse.json({ error: "Sign in to generate AI briefings (cached briefings are visible to everyone)." }, { status: 401 });
  }

  // 2) gather context
  let ctx;
  if (id) {
    const [coinR, an, fngR] = await Promise.all([safe(getCoin(id)), analyzeAsset({ coingeckoId: id, symbol: undefined }), safe(getFearGreed(1))]);
    const coin = coinR.ok ? coinR.data : null;
    // re-run with the ticker so Binance candles are used
    const analysis = coin ? await analyzeAsset({ coingeckoId: id, symbol: coin.symbol }) : an;
    ctx = {
      name: coin?.name ?? id,
      symbol: coin?.symbol ?? id.toUpperCase(),
      fundamentals: coin ? { marketCapUsd: coin.marketCapUsd, fdvUsd: coin.fdvUsd, volume24hUsd: coin.volume24hUsd, rank: coin.marketCapRank, change24hPct: coin.change24hPct, change7dPct: coin.change7dPct, change30dPct: coin.change30dPct, ath: coin.ath, athDate: coin.athDate, circulatingSupply: coin.circulatingSupply, maxSupply: coin.maxSupply, categories: coin.categories.slice(0, 5), communityUpVotePct: coin.sentimentUpPct } : undefined,
      fng: fngR.ok ? fngR.data[fngR.data.length - 1] : null,
      analysis,
    };
  } else {
    const [scan, fngR] = await Promise.all([scanAddress(address!, ["15m", "1h", "4h"]), safe(getFearGreed(1))]);
    if (!scan.analysis) return NextResponse.json({ error: scan.analysisNote || "No analysable market data for this address." }, { status: 422 });
    ctx = {
      name: scan.token?.name ?? address!,
      symbol: scan.token?.symbol ?? "?",
      fundamentals: { chain: scan.chain?.name, priceUsd: scan.market.priceUsd, liquidityUsd: scan.market.liquidityUsd, fdv: scan.market.fdv, volume24h: scan.market.volume24h, buySellRatio24h: scan.market.buySellRatio24h, txns24h: scan.market.txns24h, ageHours: scan.market.ageHours, pairCount: scan.market.pairCount, change: scan.market.change, tradingFlags: scan.tradingActivity.flags, riskLevel: scan.verdict.riskLevel },
      fng: fngR.ok ? fngR.data[fngR.data.length - 1] : null,
      security: scan.security ? { summary: scan.security.summary, riskScore: scan.security.riskScore, fails: scan.security.checks.filter((c) => c.status === "fail").map((c) => c.label), warns: scan.security.checks.filter((c) => c.status === "warn").map((c) => c.label), unverified: scan.security.checks.filter((c) => c.status === "unverified").length, top10HoldersPct: scan.security.holders.top10Pct, taxes: scan.security.taxes } : null,
      analysis: scan.analysis,
    };
  }
  const hasTf = Object.values(ctx.analysis.timeframes).some((t) => !("unavailable" in t));
  if (!hasTf) return NextResponse.json({ error: "Not enough candle history to brief on." }, { status: 422 });

  // 3) generate
  let out;
  try {
    out = await generateBriefing(ctx);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const price = (() => { for (const t of Object.values(ctx.analysis.timeframes)) if (!("unavailable" in t)) return t.price; return null; })();
  const createdAt = new Date().toISOString();
  const body = { briefing: out.data, createdAt, price, model: out.model, cached: false, history: [] as unknown[] };

  // 4) persist (history) — best effort
  if (admin) {
    const sb = await supabaseServer();
    const user = sb ? (await sb.auth.getUser()).data.user : null;
    await admin.from("ai_briefings").insert({ asset_key: assetKey, symbol: ctx.symbol, price, model: out.model, briefing: out.data, engine: ctx.analysis.consensus, input_tokens: out.inputTokens, output_tokens: out.outputTokens, requested_by: user?.id ?? null });
    const { data } = await admin.from("ai_briefings").select("id, created_at, price, briefing").eq("asset_key", assetKey).order("created_at", { ascending: false }).range(1, 6);
    body.history = (data ?? []).map((h) => ({ id: h.id, createdAt: h.created_at, price: h.price, headline: h.briefing.headline, bottomLine: h.briefing.bottomLine, suitability: h.briefing.suitability, confidence: h.briefing.confidence }));
  }
  memCache.set(assetKey, { at: Date.now(), body });
  return NextResponse.json(body);
}
