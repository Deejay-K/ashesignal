export type ExchangeId = "kraken" | "coinbase" | "binance";

export interface ExchangeBalance {
  asset: string; // normalised ticker, e.g. BTC
  total: number;
  available: number;
}

export interface ExchangeFill {
  id: string;
  time: string; // ISO
  pair: string; // e.g. BTC/USD
  base: string;
  quote: string;
  side: "buy" | "sell";
  price: number; // in quote
  amount: number; // base units
  fee: number; // in quote units (converted where possible)
  feeAsset: string;
}

export interface ExchangeCredentials {
  key: string;
  secret: string;
  passphrase?: string;
}

export interface ExchangeAdapter {
  id: ExchangeId;
  /** Verify the key works and report its permissions; throws on invalid key. */
  verify(c: ExchangeCredentials): Promise<{ ok: boolean; permissions: string[]; warning?: string }>;
  balances(c: ExchangeCredentials): Promise<ExchangeBalance[]>;
  fills(c: ExchangeCredentials, opts?: { symbols?: string[]; limit?: number }): Promise<ExchangeFill[]>;
}

/** Normalise exchange-specific asset codes to common tickers. */
export function normAsset(a: string): string {
  const m: Record<string, string> = { XXBT: "BTC", XBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC", XXLM: "XLM", XXDG: "DOGE", XDG: "DOGE", ZUSD: "USD", ZEUR: "EUR", ZCAD: "CAD", ZGBP: "GBP", ZJPY: "JPY", USDT: "USDT", USDC: "USDC" };
  const s = a.toUpperCase().replace(/\.(S|M|F|HOLD|B)$/, ""); // kraken staked/bonded suffixes
  return m[s] ?? s;
}
export const STABLES = new Set(["USD", "USDT", "USDC", "FDUSD", "DAI", "TUSD", "EUR", "CAD", "GBP", "JPY", "BUSD"]);
