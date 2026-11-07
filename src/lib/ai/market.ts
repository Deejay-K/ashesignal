// Daily market briefing builder (shared by the API route and the cron).
import { generateMarketBriefing } from "@/lib/ai/briefing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGlobal } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { discover } from "@/lib/market/discover";
import { safe } from "@/lib/fetch";

const FRESH_MS = 60 * 60_000;
let mem: { at: number; body: unknown } | null = null;

export async function buildMarketBriefing(force = false) {
  const admin = supabaseAdmin();
  if (!force) {
    if (mem && Date.now() - mem.at < FRESH_MS) return { ...(mem.body as object), cached: true };
    if (admin) {
      const { data } = await admin.from("ai_briefings").select("*").eq("asset_key", "market").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data && Date.now() - new Date(data.created_at).getTime() < FRESH_MS) return { briefing: data.briefing, createdAt: data.created_at, model: data.model, cached: true };
    }
  }
  const [g, f, d] = await Promise.all([safe(getGlobal()), safe(getFearGreed(8)), safe(discover())]);
  const fng = f.ok ? f.data : [];
  const disc = d.ok ? d.data : null;
  const data = {
    global: g.ok ? { totalMarketCapUsd: g.data.totalMarketCapUsd.value, totalVolume24hUsd: g.data.totalVolume24hUsd.value, btcDominancePct: g.data.btcDominance.value, ethDominancePct: g.data.ethDominance.value, marketCapChange24hPct: g.data.marketCapChange24hPct.value } : null,
    fearGreed: fng.length ? { today: fng[fng.length - 1], weekAgo: fng[0] } : null,
    bullishPicks4h: disc?.bullish.map((x) => ({ symbol: x.symbol, score: x.score, metric: x.metric, change24hPct: x.change24hPct })),
    bearishPicks4h: disc?.bearish.map((x) => ({ symbol: x.symbol, score: x.score, metric: x.metric, change24hPct: x.change24hPct })),
    gainers: disc?.gainers.slice(0, 6).map((x) => ({ symbol: x.symbol, change24hPct: x.change24hPct, volume24hUsd: x.volume24hUsd })),
    losers: disc?.losers.slice(0, 6).map((x) => ({ symbol: x.symbol, change24hPct: x.change24hPct, volume24hUsd: x.volume24hUsd })),
    unusualVolume: disc?.unusualVolume.slice(0, 6).map((x) => ({ symbol: x.symbol, metric: x.metric })),
    trending: disc?.trending.slice(0, 8).map((x) => x.symbol),
    dexTrending: disc?.dexTrending.slice(0, 6).map((x) => ({ symbol: x.symbol, chain: x.chain, liquidityUsd: x.liquidityUsd, change24hPct: x.change24hPct, risk: x.risk })),
  };
  const out = await generateMarketBriefing(data);
  const createdAt = new Date().toISOString();
  const body = { briefing: out.data, createdAt, model: out.model, cached: false };
  if (admin) await admin.from("ai_briefings").insert({ asset_key: "market", symbol: "MARKET", model: out.model, briefing: out.data, engine: data, input_tokens: out.inputTokens, output_tokens: out.outputTokens });
  mem = { at: Date.now(), body };
  return body;
}

