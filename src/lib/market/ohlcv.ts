// OHLCV resolution: picks the best candle source for a given asset.
//   1. Binance spot pair (verified, all timeframes)
//   2. GeckoTerminal DEX pool (verified, most timeframes; 30m/1w/1M resampled)
//   3. CoinGecko market_chart (estimated: hourly/daily closes only, no OHLC)

import { TF_MS, type Candle, type OhlcvResult, type Timeframe } from "@/lib/types";
import * as binance from "@/lib/providers/binance";
import * as gt from "@/lib/providers/geckoterminal";
import * as cg from "@/lib/providers/coingecko";
import { VENUES } from "@/lib/providers/exchanges";
import { resample } from "@/lib/ta/resample";
export { resample };

export interface AssetRef {
  symbol?: string; // ticker e.g. "SOL"
  coingeckoId?: string;
  pool?: { network: string; address: string }; // GeckoTerminal network + pool
}

export async function getOhlcv(ref: AssetRef, tf: Timeframe, limit = 500): Promise<OhlcvResult> {
  // 1) Binance
  if (ref.symbol) {
    try {
      const sym = await binance.resolveSymbol(ref.symbol);
      if (sym) {
        const candles = await binance.getKlines(sym, tf, limit);
        if (candles.length) return { candles, source: "binance", symbol: sym, quality: "verified" };
      }
    } catch (e) {
      console.warn("binance ohlcv failed", (e as Error).message);
    }
  }
  // 1b) other CEX venues (OKX → Bybit → Kraken → Coinbase)
  if (ref.symbol) {
    for (const v of VENUES) {
      try {
        const id = await v.resolve(ref.symbol);
        if (!id) continue;
        const candles = await v.klines(id, tf, limit);
        if (candles.length) return { candles, source: v.name, symbol: id, quality: "verified", note: candles.length < 60 ? `${v.name} only returned ${candles.length} candles on ${tf}.` : undefined };
      } catch (e) {
        console.warn(`${v.name} ohlcv failed`, (e as Error).message);
      }
    }
  }
  // 2) GeckoTerminal
  if (ref.pool) {
    try {
      const base = await gt.getPoolOhlcv(ref.pool.network, ref.pool.address, tf, limit);
      if (base.length) {
        const candles = tf === "30m" ? resample(base, TF_MS["30m"]) : tf === "1w" ? resample(base, TF_MS["1w"]) : tf === "1M" ? resample(base, TF_MS["1M"]) : base;
        return { candles, source: "geckoterminal", symbol: ref.pool.address, quality: "verified", note: ["30m", "1w", "1M"].includes(tf) ? "Resampled from smaller GeckoTerminal candles." : undefined };
      }
    } catch (e) {
      console.warn("geckoterminal ohlcv failed", (e as Error).message);
    }
  }
  // 3) CoinGecko fallback (no true OHLC; synthesize from close series)
  if (ref.coingeckoId && ["1h", "4h", "12h", "1d", "1w", "1M"].includes(tf)) {
    try {
      const days = tf === "1h" ? 30 : tf === "4h" || tf === "12h" ? 90 : 365;
      const chart = await cg.getMarketChart(ref.coingeckoId, days);
      const points = chart.prices.map(([t, p], idx) => ({ t, p, v: chart.total_volumes[idx]?.[1] ?? 0 }));
      const candles = synthesize(points, TF_MS[tf]);
      if (candles.length) return { candles, source: "coingecko", symbol: ref.coingeckoId, quality: "estimated", note: "No exchange candles available - OHLC synthesized from CoinGecko price samples. Wicks are approximate." };
    } catch (e) {
      console.warn("coingecko chart failed", (e as Error).message);
    }
  }
  return { candles: [], source: "none", symbol: ref.symbol ?? ref.coingeckoId ?? ref.pool?.address ?? "?", quality: "unavailable", note: "No OHLCV source could serve this asset on this timeframe." };
}

function synthesize(points: { t: number; p: number; v: number }[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  const bucketS = bucketMs / 1000;
  let cur: Candle | null = null;
  let lastV = 0;
  for (const x of points) {
    const ts = Math.floor(x.t / 1000);
    const b = Math.floor(ts / bucketS) * bucketS;
    const dv = Math.max(0, x.v - lastV) || 0; // total_volumes is 24h rolling → approximate increments
    lastV = x.v;
    if (!cur || cur.time !== b) {
      if (cur) out.push(cur);
      cur = { time: b, open: x.p, high: x.p, low: x.p, close: x.p, volume: dv };
    } else {
      cur.high = Math.max(cur.high, x.p);
      cur.low = Math.min(cur.low, x.p);
      cur.close = x.p;
      cur.volume += dv;
    }
  }
  if (cur) out.push(cur);
  return out;
}
