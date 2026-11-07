import { NextResponse } from "next/server";
import { getTradingSymbols, getKlines } from "@/lib/providers/binance";
import { getGlobal } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { searchPairs } from "@/lib/providers/dexscreener";
import { getTrendingPools } from "@/lib/providers/geckoterminal";
import { SUPABASE_ENABLED } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/** Provider diagnostics — open /api/health on the deployed site to see what works from the server. */
export async function GET() {
  const t = async (name: string, fn: () => Promise<unknown>) => {
    const s = Date.now();
    try {
      await fn();
      return { name, ok: true, ms: Date.now() - s };
    } catch (e) {
      return { name, ok: false, ms: Date.now() - s, error: (e as Error).message };
    }
  };
  const checks = await Promise.all([
    t("binance.exchangeInfo", () => getTradingSymbols()),
    t("binance.klines BTCUSDT 1h", () => getKlines("BTCUSDT", "1h", 50)),
    t("coingecko.global", () => getGlobal()),
    t("dexscreener.search", () => searchPairs("PEPE")),
    t("geckoterminal.trending", () => getTrendingPools()),
    t("alternative.me.fng", () => getFearGreed(1)),
  ]);
  return NextResponse.json({
    ok: checks.every((c) => c.ok),
    checks,
    config: {
      coingeckoKey: process.env.COINGECKO_API_KEY ? "demo key set" : process.env.COINGECKO_PRO_API_KEY ? "pro key set" : "none (anonymous, 30/min)",
      supabase: SUPABASE_ENABLED ? "configured" : "not configured (guest mode)",
      serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing (worker disabled)",
      cronSecret: process.env.CRON_SECRET ? "set" : "missing (cron open in dev, locked in prod)",
      push: process.env.VAPID_PUBLIC_KEY ? "configured" : "not configured",
      email: process.env.RESEND_API_KEY ? "configured" : "not configured",
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    at: new Date().toISOString(),
  });
}
