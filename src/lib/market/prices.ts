// Cross-exchange live price board + aggregate.

import { safe } from "@/lib/fetch";
import { getTicker24h, resolveSymbol } from "@/lib/providers/binance";
import { VENUES } from "@/lib/providers/exchanges";

export interface VenuePrice {
  venue: string;
  instrument: string;
  last: number;
  volumeQuote24h: number | null;
  change24hPct: number | null;
}

export interface PriceBoard {
  symbol: string;
  venues: VenuePrice[];
  aggregate: number | null; // volume-weighted
  spreadPct: number | null; // (max-min)/aggregate
  errors: string[];
  generatedAt: number;
}

export async function priceBoard(ticker: string): Promise<PriceBoard> {
  const errors: string[] = [];
  const venues: VenuePrice[] = [];
  await Promise.all([
    (async () => {
      const sym = await safe(resolveSymbol(ticker));
      if (!sym.ok || !sym.data) return;
      const t = await safe(getTicker24h(sym.data));
      if (t.ok) venues.push({ venue: "binance", instrument: sym.data, last: t.data.lastPrice, volumeQuote24h: t.data.quoteVolume, change24hPct: t.data.priceChangePercent });
      else errors.push(`binance: ${t.error}`);
    })(),
    ...VENUES.map(async (v) => {
      const id = await safe(v.resolve(ticker));
      if (!id.ok || !id.data) return;
      const t = await safe(v.ticker(id.data));
      if (t.ok) venues.push({ venue: v.name, instrument: id.data, ...t.data });
      else errors.push(`${v.name}: ${t.error}`);
    }),
  ]);
  const priced = venues.filter((v) => v.last > 0);
  const wsum = priced.reduce((s, v) => s + (v.volumeQuote24h ?? 0), 0);
  const aggregate = priced.length ? (wsum > 0 ? priced.reduce((s, v) => s + v.last * (v.volumeQuote24h ?? 0), 0) / wsum : priced.reduce((s, v) => s + v.last, 0) / priced.length) : null;
  const spreadPct = aggregate && priced.length > 1 ? ((Math.max(...priced.map((v) => v.last)) - Math.min(...priced.map((v) => v.last))) / aggregate) * 100 : null;
  return { symbol: ticker.toUpperCase(), venues: priced.sort((a, b) => (b.volumeQuote24h ?? 0) - (a.volumeQuote24h ?? 0)), aggregate, spreadPct, errors, generatedAt: Date.now() };
}
