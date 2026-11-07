import type { Candle } from "@/lib/types";

/** Aggregate candles into larger buckets (bucketMs). Input must be ascending. */
export function resample(c: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  const bucketS = bucketMs / 1000;
  let cur: Candle | null = null;
  for (const x of c) {
    const b = Math.floor(x.time / bucketS) * bucketS;
    if (!cur || cur.time !== b) {
      if (cur) out.push(cur);
      cur = { time: b, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume };
    } else {
      cur.high = Math.max(cur.high, x.high);
      cur.low = Math.min(cur.low, x.low);
      cur.close = x.close;
      cur.volume += x.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

