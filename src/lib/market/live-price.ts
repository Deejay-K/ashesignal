// Stage 56 - live prices from the exchanges (the same free candle feeds the screener uses), with the shared CoinGecko
// cache only as a fallback. Follow-ups and speculative alerts run every 5 minutes; asking CoinGecko for prices that
// often used up its free limits.

import { getOhlcv } from "./ohlcv";
import { getMarketsByIds } from "@/lib/providers/coingecko";
import { safe } from "@/lib/fetch";

export async function livePrices(coins: { id: string; symbol: string }[], opts: { concurrency?: number; timeoutMs?: number } = {}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Map(coins.filter((c) => c.id && c.symbol).map((c) => [c.id, c])).values()];
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let i = 0;
  const worker = async () => {
    while (i < uniq.length && Date.now() < deadline) {
      const c = uniq[i++];
      const k = await safe(getOhlcv({ symbol: c.symbol, coingeckoId: c.id }, "15m", 3));
      // Only real exchange candles: CoinGecko-estimated candles would cost the same rate-limited calls.
      if (k.ok && k.data.quality === "verified" && k.data.candles.length) out.set(c.id, k.data.candles[k.data.candles.length - 1].close);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 5, uniq.length) }, worker));
  const missing = uniq.filter((c) => !out.has(c.id)).map((c) => c.id);
  if (missing.length) {
    const mk = await safe(getMarketsByIds(missing));
    if (mk.ok) for (const m of mk.data) if (m.priceUsd) out.set(m.id, m.priceUsd);
  }
  return out;
}
