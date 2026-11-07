// Additional CEX public market data: Kraken, Coinbase, OKX, Bybit. No keys.
// Each exposes: resolve(ticker) → instrument id, klines(id, tf, limit), ticker(id).
// Timeframes a venue lacks are resampled from the next smaller one by the resolver.

import { fetchJson } from "@/lib/fetch";
import { TF_MS, type Candle, type Timeframe } from "@/lib/types";
import { resample } from "@/lib/ta/resample";

export interface Venue {
  name: "binance" | "kraken" | "coinbase" | "okx" | "bybit";
  resolve(ticker: string): Promise<string | null>;
  klines(id: string, tf: Timeframe, limit: number): Promise<Candle[]>;
  ticker(id: string): Promise<{ last: number; volumeQuote24h: number | null; change24hPct: number | null }>;
  /** All spot tickers against a USD-like quote in one call (for gainers/losers/unusual-volume scans). */
  allTickers?(): Promise<{ base: string; instrument: string; last: number; volumeQuote24h: number; change24hPct: number }[]>;
  /** Base tickers with a USD-like spot pair on this venue (cached about an hour). */
  bases?(): Promise<Set<string>>;
}

const basesFrom = (ids: Iterable<string>, split: (id: string) => string | null) => { const out = new Set<string>(); for (const id of ids) { const b = split(id); if (b) out.add(b); } return out; };

const QUOTES = ["USDT", "USD", "USDC"];

/* ---------------- Kraken ---------------- */
const KRAKEN_TF: Partial<Record<Timeframe, number>> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "12h": 240, "1d": 1440, "1w": 10080, "1M": 1440 };
let krakenPairs: Map<string, string> | null = null; // "BTCUSD" -> "XXBTZUSD"
async function krakenPairMap() {
  if (krakenPairs) return krakenPairs;
  const r = await fetchJson<{ result: Record<string, { altname: string; wsname?: string; status?: string }> }>("https://api.kraken.com/0/public/AssetPairs", { provider: "kraken", ttl: 3_600_000 });
  krakenPairs = new Map();
  for (const [id, p] of Object.entries(r.result)) {
    if (p.status && p.status !== "online") continue;
    krakenPairs.set(p.altname.toUpperCase(), id);
    if (p.wsname) krakenPairs.set(p.wsname.replace("/", "").toUpperCase(), id);
  }
  return krakenPairs;
}
export const kraken: Venue = {
  name: "kraken",
  async resolve(t) {
    const m = await krakenPairMap();
    const base = t.toUpperCase() === "BTC" ? ["XBT", "BTC"] : [t.toUpperCase()];
    for (const b of base) for (const q of QUOTES) if (m.has(`${b}${q}`)) return m.get(`${b}${q}`)!;
    return null;
  },
  async klines(id, tf, limit) {
    const iv = KRAKEN_TF[tf];
    if (!iv) return [];
    const r = await fetchJson<{ result: Record<string, unknown[][] | number> }>(`https://api.kraken.com/0/public/OHLC?pair=${id}&interval=${iv}`, { provider: "kraken", ttl: 60_000 });
    const arr = Object.entries(r.result).find(([k]) => k !== "last")?.[1] as unknown[][] | undefined;
    const c = (arr ?? []).map((k) => ({ time: Number(k[0]), open: +k[1]!, high: +k[2]!, low: +k[3]!, close: +k[4]!, volume: +k[6]! }));
    const out = tf === "12h" || tf === "1M" ? resample(c, TF_MS[tf]) : c;
    return out.slice(-limit);
  },
  async ticker(id) {
    const r = await fetchJson<{ result: Record<string, { c: string[]; v: string[]; o: string }> }>(`https://api.kraken.com/0/public/Ticker?pair=${id}`, { provider: "kraken", ttl: 15_000 });
    const t = Object.values(r.result)[0];
    const last = +t.c[0];
    return { last, volumeQuote24h: +t.v[1] * last, change24hPct: ((last - +t.o) / +t.o) * 100 };
  },
  async bases() {
    const m = await krakenPairMap();
    return basesFrom(m.keys(), (alt) => (/USD$/.test(alt) && !/USDT$|PYUSD$|USDC$/.test(alt) ? alt.slice(0, -3).replace(/^XBT$/, "BTC") : null));
  },
  async allTickers() {
    const m = await krakenPairMap();
    const byId = new Map<string, string>();
    for (const [alt, id] of m) if (alt.endsWith("USD") && !alt.endsWith("USDT") && !alt.endsWith("PYUSD")) byId.set(id, alt);
    const r = await fetchJson<{ result: Record<string, { c: string[]; v: string[]; o: string }> }>("https://api.kraken.com/0/public/Ticker", { provider: "kraken", ttl: 30_000 });
    const out: { base: string; instrument: string; last: number; volumeQuote24h: number; change24hPct: number }[] = [];
    for (const [id, t] of Object.entries(r.result)) {
      const alt = byId.get(id);
      if (!alt || +t.o <= 0) continue;
      const base = alt.slice(0, -3).replace(/^XBT$/, "BTC");
      out.push({ base, instrument: id, last: +t.c[0], volumeQuote24h: +t.v[1] * +t.c[0], change24hPct: ((+t.c[0] - +t.o) / +t.o) * 100 });
    }
    return out;
  },
};

/* ---------------- Coinbase ---------------- */
const CB_TF: Partial<Record<Timeframe, number>> = { "1m": 60, "5m": 300, "15m": 900, "30m": 900, "1h": 3600, "4h": 3600, "12h": 21600, "1d": 86400, "1w": 86400, "1M": 86400 };
let cbProducts: Set<string> | null = null;
async function cbProductSet() {
  if (!cbProducts) {
    const r = await fetchJson<{ id: string; status: string }[]>("https://api.exchange.coinbase.com/products", { provider: "coinbase", ttl: 3_600_000 });
    cbProducts = new Set(r.filter((p) => p.status === "online").map((p) => p.id));
  }
  return cbProducts;
}
export const coinbase: Venue = {
  name: "coinbase",
  async bases() { return basesFrom(await cbProductSet(), (id) => { const [b, q] = id.split("-"); return q === "USD" || q === "USDT" || q === "USDC" ? b : null; }); },
  async resolve(t) {
    const set = await cbProductSet();
    for (const q of ["USD", "USDT", "USDC"]) if (set.has(`${t.toUpperCase()}-${q}`)) return `${t.toUpperCase()}-${q}`;
    return null;
  },
  async klines(id, tf, limit) {
    const g = CB_TF[tf];
    if (!g) return [];
    const r = await fetchJson<number[][]>(`https://api.exchange.coinbase.com/products/${id}/candles?granularity=${g}`, { provider: "coinbase", ttl: 60_000 });
    const c = r.map((k) => ({ time: k[0], open: k[3], high: k[2], low: k[1], close: k[4], volume: k[5] })).sort((a, b) => a.time - b.time);
    const need = ["30m", "4h", "1w", "1M"].includes(tf);
    return (need ? resample(c, TF_MS[tf]) : c).slice(-limit);
  },
  async ticker(id) {
    const [t, s] = await Promise.all([
      fetchJson<{ price: string; volume: string }>(`https://api.exchange.coinbase.com/products/${id}/ticker`, { provider: "coinbase", ttl: 15_000 }),
      fetchJson<{ open: string; last: string }>(`https://api.exchange.coinbase.com/products/${id}/stats`, { provider: "coinbase", ttl: 30_000 }),
    ]);
    const last = +t.price;
    return { last, volumeQuote24h: +t.volume * last, change24hPct: ((last - +s.open) / +s.open) * 100 };
  },
};

/* ---------------- OKX ---------------- */
const OKX_TF: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "12h": "12H", "1d": "1D", "1w": "1W", "1M": "1M" };
let okxInst: Set<string> | null = null;
async function okxInstSet() {
  if (!okxInst) {
    const r = await fetchJson<{ data: { instId: string; state: string }[] }>("https://www.okx.com/api/v5/public/instruments?instType=SPOT", { provider: "okx", ttl: 3_600_000 });
    okxInst = new Set(r.data.filter((i) => i.state === "live").map((i) => i.instId));
  }
  return okxInst;
}
export const okx: Venue = {
  name: "okx",
  async bases() { return basesFrom(await okxInstSet(), (id) => { const [b, q] = id.split("-"); return q === "USDT" || q === "USDC" ? b : null; }); },
  async resolve(t) {
    const set = await okxInstSet();
    for (const q of ["USDT", "USDC"]) if (set.has(`${t.toUpperCase()}-${q}`)) return `${t.toUpperCase()}-${q}`;
    return null;
  },
  async klines(id, tf, limit) {
    const r = await fetchJson<{ data: string[][] }>(`https://www.okx.com/api/v5/market/candles?instId=${id}&bar=${OKX_TF[tf]}&limit=${Math.min(limit, 300)}`, { provider: "okx", ttl: 60_000 });
    return r.data.map((k) => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).sort((a, b) => a.time - b.time);
  },
  async ticker(id) {
    const r = await fetchJson<{ data: { last: string; volCcy24h: string; open24h: string }[] }>(`https://www.okx.com/api/v5/market/ticker?instId=${id}`, { provider: "okx", ttl: 15_000 });
    const t = r.data[0];
    return { last: +t.last, volumeQuote24h: +t.volCcy24h, change24hPct: ((+t.last - +t.open24h) / +t.open24h) * 100 };
  },
  async allTickers() {
    const r = await fetchJson<{ data: { instId: string; last: string; volCcy24h: string; open24h: string }[] }>("https://www.okx.com/api/v5/market/tickers?instType=SPOT", { provider: "okx", ttl: 30_000 });
    return r.data.filter((t) => t.instId.endsWith("-USDT") && +t.open24h > 0).map((t) => ({ base: t.instId.replace("-USDT", ""), instrument: t.instId, last: +t.last, volumeQuote24h: +t.volCcy24h, change24hPct: ((+t.last - +t.open24h) / +t.open24h) * 100 }));
  },
};

/* ---------------- Bybit ---------------- */
const BYBIT_TF: Record<Timeframe, string> = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "12h": "720", "1d": "D", "1w": "W", "1M": "M" };
let bybitSyms: Set<string> | null = null;
async function bybitSymSet() {
  if (!bybitSyms) {
    const r = await fetchJson<{ result: { list: { symbol: string; status: string }[] } }>("https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000", { provider: "bybit", ttl: 3_600_000 });
    bybitSyms = new Set(r.result.list.filter((i) => i.status === "Trading").map((i) => i.symbol));
  }
  return bybitSyms;
}
export const bybit: Venue = {
  name: "bybit",
  async bases() { return basesFrom(await bybitSymSet(), (id) => (id.endsWith("USDT") ? id.slice(0, -4) : id.endsWith("USDC") ? id.slice(0, -4) : null)); },
  async resolve(t) {
    const set = await bybitSymSet();
    for (const q of ["USDT", "USDC"]) if (set.has(`${t.toUpperCase()}${q}`)) return `${t.toUpperCase()}${q}`;
    return null;
  },
  async klines(id, tf, limit) {
    const r = await fetchJson<{ result: { list: string[][] } }>(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${id}&interval=${BYBIT_TF[tf]}&limit=${Math.min(limit, 1000)}`, { provider: "bybit", ttl: 60_000 });
    return r.result.list.map((k) => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).sort((a, b) => a.time - b.time);
  },
  async ticker(id) {
    const r = await fetchJson<{ result: { list: { lastPrice: string; turnover24h: string; price24hPcnt: string }[] } }>(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${id}`, { provider: "bybit", ttl: 15_000 });
    const t = r.result.list[0];
    return { last: +t.lastPrice, volumeQuote24h: +t.turnover24h, change24hPct: +t.price24hPcnt * 100 };
  },
  async allTickers() {
    const r = await fetchJson<{ result: { list: { symbol: string; lastPrice: string; turnover24h: string; price24hPcnt: string }[] } }>("https://api.bybit.com/v5/market/tickers?category=spot", { provider: "bybit", ttl: 30_000 });
    return r.result.list.filter((t) => t.symbol.endsWith("USDT")).map((t) => ({ base: t.symbol.replace(/USDT$/, ""), instrument: t.symbol, last: +t.lastPrice, volumeQuote24h: +t.turnover24h, change24hPct: +t.price24hPcnt * 100 }));
  },
};

export const VENUES: Venue[] = [okx, bybit, kraken, coinbase];
