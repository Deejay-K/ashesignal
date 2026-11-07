// Cross-exchange live price board + aggregate.

import { safe } from "@/lib/fetch";
import { venueOrder, type VenueId } from "@/lib/venues";

export interface VenuePrice {
  venue: string;
  active?: boolean;
  instrument: string;
  last: number;
  volumeQuote24h: number | null;
  change24hPct: number | null;
}

export interface PriceBoard {
  symbol: string;
  activeVenue: VenueId;
  venues: VenuePrice[];
  aggregate: number | null; // volume-weighted
  spreadPct: number | null; // (max-min)/aggregate
  errors: string[];
  generatedAt: number;
}

export async function priceBoard(ticker: string, active?: VenueId | null): Promise<PriceBoard> {
  const errors: string[] = [];
  const venues: VenuePrice[] = [];
  const order = venueOrder(active);
  await Promise.all(order.map(async (v) => {
    const id = await safe(v.resolve(ticker));
    if (!id.ok || !id.data) return;
    const t = await safe(v.ticker(id.data));
    if (t.ok) venues.push({ venue: v.name, active: v === order[0], instrument: id.data, ...t.data });
    else errors.push(`${v.name}: ${t.error}`);
  }));
  const priced = venues.filter((v) => v.last > 0);
  const wsum = priced.reduce((s, v) => s + (v.volumeQuote24h ?? 0), 0);
  const aggregate = priced.length ? (wsum > 0 ? priced.reduce((s, v) => s + v.last * (v.volumeQuote24h ?? 0), 0) / wsum : priced.reduce((s, v) => s + v.last, 0) / priced.length) : null;
  const spreadPct = aggregate && priced.length > 1 ? ((Math.max(...priced.map((v) => v.last)) - Math.min(...priced.map((v) => v.last))) / aggregate) * 100 : null;
  return { symbol: ticker.toUpperCase(), activeVenue: order[0].name as VenueId, venues: priced.sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.volumeQuote24h ?? 0) - (a.volumeQuote24h ?? 0)), aggregate, spreadPct, errors, generatedAt: Date.now() };
}
