// The row the screener writes to the signals ledger for every new Confirmed or speculative setup.
// Kept separate from the route so the exact row can be tested against the database.

import type { Setup } from "./ta/analysis";
import type { ConfirmedSignal } from "./telegram-broadcast";

export interface QueueInput {
  c: { id: string; symbol: string; name: string; volume24hUsd?: number | null };
  tf: string; setup: Setup; price: number;
  kind: "confirmed" | "speculative";
  qualifies: string[]; rank: number | null; htfAligned: boolean | null;
  /** "2026-11-24T16": one row per setup per hour, so a retried scan never queues the same signal twice. */
  hourBucket: string;
}

export function queueRow(i: QueueInput): Record<string, unknown> {
  const s = i.setup, entry = s.entry, sl = s.stopLosses[0].price, tp1 = s.takeProfits[0]?.price ?? null;
  const payload: ConfirmedSignal = { coingeckoId: i.c.id, symbol: i.c.symbol, name: i.c.name, timeframe: i.tf as ConfirmedSignal["timeframe"], price: i.price, setup: s, qualifies: i.qualifies };
  return {
    dedupe_key: `cg:${i.c.id}|${i.tf}|${s.side}|${entry.low}|${entry.high}|${sl}|${tp1}|${i.hourBucket}`,
    coingecko_id: i.c.id, asset_key: `cg:${i.c.id}`, symbol: i.c.symbol, timeframe: i.tf, side: s.side, kind: i.kind,
    entry_low: entry.low, entry_high: entry.high, entry_mid: entry.mid, sl1: sl, tp1,
    tp2: s.takeProfits[1]?.price ?? null, tp3: s.takeProfits[2]?.price ?? null,
    rr_tp2: s.riskRewardTp2, confidence: s.confidence, price_at_signal: i.price,
    htf_aligned: i.htfAligned, volume_24h: i.c.volume24hUsd ?? null, market_rank: i.rank, payload,
  };
}
