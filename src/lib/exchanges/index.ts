import { kraken } from "./kraken";
import { coinbase } from "./coinbase";
import { binance } from "./binance";
import { okx } from "./okx";
import { bybit } from "./bybit";
import type { ExchangeAdapter, ExchangeFill, ExchangeId } from "./types";
import { STABLES } from "./types";

export const ADAPTERS: Record<ExchangeId, ExchangeAdapter> = { binance, okx, bybit, kraken, coinbase };
export const EXCHANGE_LABELS: Record<ExchangeId, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit", kraken: "Kraken", coinbase: "Coinbase" };

export interface RealizedLot { asset: string; realizedUsd: number; feesUsd: number; buys: number; sells: number; remaining: number; avgCost: number | null; firstTrade: string | null; lastTrade: string | null }

/** FIFO realized P&L per base asset from fills in USD-like quotes (USD/USDT/USDC treated 1:1). */
export function realizedPnl(fills: ExchangeFill[]): { perAsset: RealizedLot[]; totalRealizedUsd: number; totalFeesUsd: number; tradeCount: number; unpricedQuotes: string[] } {
  const sorted = [...fills].sort((a, b) => a.time.localeCompare(b.time));
  const lots = new Map<string, { amount: number; cost: number }[]>();
  const acc = new Map<string, RealizedLot>();
  const unpriced = new Set<string>();
  for (const f of sorted) {
    if (!STABLES.has(f.quote)) { unpriced.add(f.quote); continue; }
    const a = acc.get(f.base) ?? { asset: f.base, realizedUsd: 0, feesUsd: 0, buys: 0, sells: 0, remaining: 0, avgCost: null, firstTrade: null, lastTrade: null };
    a.firstTrade = a.firstTrade ?? f.time;
    a.lastTrade = f.time;
    a.feesUsd += f.fee;
    const q = lots.get(f.base) ?? [];
    if (f.side === "buy") {
      q.push({ amount: f.amount, cost: f.price });
      a.buys++;
    } else {
      let rem = f.amount;
      while (rem > 1e-12 && q.length) {
        const lot = q[0];
        const take = Math.min(rem, lot.amount);
        a.realizedUsd += (f.price - lot.cost) * take;
        lot.amount -= take;
        rem -= take;
        if (lot.amount <= 1e-12) q.shift();
      }
      if (rem > 1e-12) a.realizedUsd += f.price * rem; // sold more than known buys (deposits): treat cost as unknown=0, flagged below
      a.sells++;
    }
    a.realizedUsd -= f.fee;
    lots.set(f.base, q);
    acc.set(f.base, a);
  }
  for (const [asset, q] of lots) {
    const a = acc.get(asset)!;
    a.remaining = q.reduce((s, l) => s + l.amount, 0);
    a.avgCost = a.remaining > 0 ? q.reduce((s, l) => s + l.amount * l.cost, 0) / a.remaining : null;
  }
  const perAsset = [...acc.values()].sort((x, y) => Math.abs(y.realizedUsd) - Math.abs(x.realizedUsd));
  return { perAsset, totalRealizedUsd: perAsset.reduce((s, x) => s + x.realizedUsd, 0), totalFeesUsd: perAsset.reduce((s, x) => s + x.feesUsd, 0), tradeCount: sorted.length, unpricedQuotes: [...unpriced] };
}
