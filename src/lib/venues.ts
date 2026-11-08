// Exchange registry: every market-data venue behind one interface, with metadata and the
// "active venue" preference. Adding an exchange = add a Venue in providers/exchanges.ts (or a
// wrapper like binanceVenue below) and one META entry here. Nothing else in the app needs to change.

import type { Candle, Timeframe } from "@/lib/types";
import * as binance from "@/lib/providers/binance";
import { okx, bybit, kraken, coinbase, type Venue } from "@/lib/providers/exchanges";

export type VenueId = "binance" | "okx" | "bybit" | "kraken" | "coinbase";
export const VENUE_IDS: VenueId[] = ["binance", "okx", "bybit", "kraken", "coinbase"];
export const DEFAULT_VENUE: VenueId = "binance";
export const isVenueId = (v: unknown): v is VenueId => typeof v === "string" && (VENUE_IDS as string[]).includes(v);

export interface BulkTicker { base: string; instrument: string; last: number; volumeQuote24h: number; change24hPct: number }

export interface VenueMeta {
  id: VenueId;
  label: string;
  quotes: string[];                       // preferred quote order
  instrument: (base: string, quote: string) => string;   // display format of a pair
  tradeUrl: (base: string, quote: string) => string;     // deep link to the spot trading page
  accounts: boolean;                      // read-only account connection supported
  canShort: boolean;                      // offers perpetuals or spot margin (shorting) to most users
  note: string;
  color: string;
}

export const VENUE_META: Record<VenueId, VenueMeta> = {
  binance: { id: "binance", label: "Binance", quotes: ["USDT", "FDUSD", "USDC"], instrument: (b, q) => `${b}${q}`, tradeUrl: (b, q) => `https://www.binance.com/en/trade/${b}_${q}?type=spot`, accounts: true, canShort: true, note: "Largest spot liquidity, all 10 timeframes. Not available to residents of Canada, the US and some other regions.", color: "#f3ba2f" },
  okx: { id: "okx", label: "OKX", quotes: ["USDT", "USDC"], instrument: (b, q) => `${b}-${q}`, tradeUrl: (b, q) => `https://www.okx.com/trade-spot/${b.toLowerCase()}-${q.toLowerCase()}`, accounts: true, canShort: true, note: "Deep altcoin coverage, all timeframes, 300 candles per request.", color: "#ffffff" },
  bybit: { id: "bybit", label: "Bybit", quotes: ["USDT", "USDC"], instrument: (b, q) => `${b}${q}`, tradeUrl: (b, q) => `https://www.bybit.com/trade/spot/${b}/${q}`, accounts: true, canShort: true, note: "Wide listing, all timeframes, up to 1000 candles.", color: "#f7a600" },
  kraken: { id: "kraken", label: "Kraken", quotes: ["USD", "USDT", "USDC"], instrument: (b, q) => `${b === "BTC" ? "XBT" : b}/${q}`, tradeUrl: (b, q) => `https://pro.kraken.com/app/trade/${b.toLowerCase()}-${q.toLowerCase()}`, accounts: true, canShort: true, note: "USD pairs, regulated in Canada/US/EU. 12h and 1M candles are resampled.", color: "#5741d9" },
  coinbase: { id: "coinbase", label: "Coinbase", quotes: ["USD", "USDT", "USDC"], instrument: (b, q) => `${b}-${q}`, tradeUrl: (b, q) => `https://www.coinbase.com/advanced-trade/spot/${b}-${q}`, accounts: true, canShort: false, note: "USD pairs, regulated in Canada/US. Spot only: LONG setups can be placed, SHORT setups cannot (no margin or perpetuals). 30m, 4h, 1w and 1M candles are resampled.", color: "#0052ff" },
};

/** Binance exposed through the same Venue interface as the others. */
export const binanceVenue: Venue & { allTickers: () => Promise<BulkTicker[]> } = {
  name: "binance" as Venue["name"],
  resolve: (t) => binance.resolveSymbol(t),
  klines: (id, tf, limit) => binance.getKlines(id, tf, limit),
  async ticker(id) { const t = await binance.getTicker24h(id); return { last: t.lastPrice, volumeQuote24h: t.quoteVolume, change24hPct: t.priceChangePercent }; },
  async bases() { const set = await binance.getTradingSymbols(); const out = new Set<string>(); for (const sym of set) for (const q of ["USDT", "FDUSD", "USDC"]) if (sym.endsWith(q)) { out.add(sym.slice(0, -q.length)); break; } return out; },
  async allTickers() { const r = await binance.getAllUsdtTickers(); return r.map((t) => ({ base: t.symbol.replace(/USDT$/, ""), instrument: t.symbol, last: t.lastPrice, volumeQuote24h: t.quoteVolume, change24hPct: t.priceChangePercent })); },
};

export type AnyVenue = Venue & { allTickers?: () => Promise<BulkTicker[]>; bases?: () => Promise<Set<string>> };

let listingsMemo: { at: number; value: Promise<Record<VenueId, Set<string>>> } | null = null;
/** Which venues list which base tickers; one call per venue, cached 30 min. Failures yield an empty set for that venue. */
export function venueListings(): Promise<Record<VenueId, Set<string>>> {
  if (listingsMemo && Date.now() - listingsMemo.at < 30 * 60_000) return listingsMemo.value;
  const value = (async () => {
    const out = {} as Record<VenueId, Set<string>>;
    await Promise.all(VENUE_IDS.map(async (id) => { try { out[id] = (await VENUES_BY_ID[id].bases?.()) ?? new Set(); } catch { out[id] = new Set(); } }));
    return out;
  })();
  listingsMemo = { at: Date.now(), value };
  return value;
}
/** Venues that list a ticker, active one first. */
export function venuesFor(symbol: string, listings: Record<VenueId, Set<string>>, active?: VenueId | null): VenueId[] {
  const s = symbol.toUpperCase();
  const all = VENUE_IDS.filter((v) => listings[v]?.has(s));
  if (active && all.includes(active)) return [active, ...all.filter((v) => v !== active)];
  return all;
}
export const VENUES_BY_ID: Record<VenueId, AnyVenue> = { binance: binanceVenue, okx, bybit, kraken, coinbase };

/** Venues in try-order: the active one first, then the rest in default liquidity order. */
export function venueOrder(active?: VenueId | null): AnyVenue[] {
  const a = active && isVenueId(active) ? active : DEFAULT_VENUE;
  return [VENUES_BY_ID[a], ...VENUE_IDS.filter((v) => v !== a).map((v) => VENUES_BY_ID[v])];
}

/** Split an instrument id back into base/quote for display and trade links. */
export function splitInstrument(venue: VenueId, instrument: string): { base: string; quote: string } {
  const quotes = ["USDT", "FDUSD", "USDC", "ZUSD", "USD", "BTC", "EUR"];
  // Kraken legacy ids carry X/Z prefixes (XXBTZUSD, XETHZUSD, XXRPZUSD); other venues use plain tickers.
  const fixBase = (b: string) => (/^X?XBT$/.test(b) ? "BTC" : venue === "kraken" && b.length === 4 && b.startsWith("X") ? b.slice(1) : b);
  const parts = instrument.split(/[-/]/);
  if (parts.length === 2) return { base: fixBase(parts[0]), quote: parts[1].replace(/^Z/, "") };
  for (const q of quotes) if (instrument.endsWith(q)) return { base: fixBase(instrument.slice(0, -q.length)), quote: q.replace(/^Z/, "") };
  return { base: instrument, quote: "USDT" };
}

/** Trade link for a ticker on a venue without resolving (uses the venue's first quote). */
export function tradeLink(venue: VenueId, base: string, quote?: string) {
  const m = VENUE_META[venue];
  return m.tradeUrl(base.toUpperCase(), quote ?? m.quotes[0]);
}
