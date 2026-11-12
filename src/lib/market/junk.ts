// Stage 42 - What counts as a real, tradeable coin for the market lists. Stablecoins, wrapped or staked copies of
// another coin, and tokenized stocks, funds, treasuries and commodities sit high in market-cap rankings but are not
// things anyone trades for a move. They are hidden from the homepage lists by default.
// Name-based heuristics: new tokens of these kinds appear all the time, so this is a best effort, not a registry.

export type AssetKind = "coin" | "stable" | "wrapped" | "tokenized";

const STABLE_SYM = /^(USDT|USDC|DAI|FDUSD|TUSD|PYUSD|USDE|SUSDE|USDS|SUSDS|USD1|USD0|USDD|USDP|USDG|USDF|USDX|USDY|USDL|USDB|USDTB|USDT0|RLUSD|BUSD|GUSD|LUSD|FRAX|FRXUSD|CRVUSD|GHO|DOLA|EURC|EURS|EURT|EURI|AUSD|BFUSD|SUSD|USR|USDA|USD\+|BSC-USD|BUIDL|USYC|USTB|OUSG|USDM|MUSD|HONEY|USDO|YUSD|SYRUPUSDC|SYRUPUSDT)$/i;
const STABLE_NAME = /\b(usd coin|stablecoin|digital dollar|digital euro|dollar\b.*\b(stable|token)|bridged us(dc|dt)|savings (dai|usds))\b/i;
const WRAPPED_SYM = /^(WBTC|WETH|WBNB|WSOL|WAVAX|WMATIC|WPOL|STETH|WSTETH|RETH|CBETH|CBBTC|WEETH|EETH|WBETH|EZETH|RSETH|METH|CMETH|SWETH|OSETH|LSETH|ETHX|FRXETH|SFRXETH|TBTC|LBTC|SOLVBTC|FBTC|KBTC|PUMPBTC|CLBTC|EBTC|BTCB|BTC\.B|JITOSOL|MSOL|BNSOL|JUPSOL|BBSOL|STSOL|SAVAX|STKAAVE|WHYPE|KHYPE|STHYPE|WTRX|STRX)$/i;
const WRAPPED_NAME = /\b(wrapped|staked|restaked|liquid stak|bridged|binance-peg|coinbase wrapped|rocket pool eth|solv protocol (btc|bitcoin)|binance staked)\b/i;
const TOKENIZED_NAME = /\b(tokenized|xstock|x stock|ondo tokenized|backed|heloc|treasur(y|ies)|t-bill|money market|\bfund\b|buidl|tether gold|pax gold|kinesis (gold|silver)|\bgold\b|\bsilver\b|real estate|\bstock\b|\betf\b|superstate|hashnote|franklin|blackrock|janus henderson|wisdomtree)\b/i;
const TOKENIZED_SYM = /^(XAUT|PAXG|KAU|KAG|FIGR_HELOC|BENJI|[A-Z]{2,5}(X|ON))$/;
// Real coins that the suffix or name rules above would catch by accident.
const KEEP = new Set(["AXON", "TON", "MON", "ZETAX", "AVAX", "TRX", "IMX", "DYDX", "GMX", "SNX", "FLUX", "ZRX", "CVX", "CFX", "STX", "MX", "NEON", "TRON", "RON", "PYTHON", "SXT", "BAX", "KAVAX"]);

export function assetKind(c: { symbol?: string | null; name?: string | null }): AssetKind {
  const sym = String(c.symbol ?? "").toUpperCase(), name = String(c.name ?? "");
  if (STABLE_SYM.test(sym) || STABLE_NAME.test(name)) return "stable";
  if (WRAPPED_SYM.test(sym) || WRAPPED_NAME.test(name)) return "wrapped";
  if (TOKENIZED_NAME.test(name)) return "tokenized";
  if (!KEEP.has(sym) && TOKENIZED_SYM.test(sym) && /tokeni|stock|xstock|ondo|backed|gold|heloc/i.test(name + " " + sym)) return "tokenized";
  return "coin";
}
export const isRealCoin = (c: { symbol?: string | null; name?: string | null }) => assetKind(c) === "coin";

/** Smallest market cap a coin needs to appear in gainers, losers and unusual volume. */
export const MIN_LIST_CAP = 20_000_000;
/** Turnover (24h volume over market cap) above this is almost always a stale market cap or wash trading, not a signal. */
export const MAX_SANE_TURNOVER = 1;
