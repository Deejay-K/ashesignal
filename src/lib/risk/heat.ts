// Portfolio heat: how much of the account is at risk across all open journal trades, and whether they are
// really one bet (same direction on correlated coins). Pure function; the API feeds it the open trades.

export interface OpenTrade { symbol: string; side: "LONG" | "SHORT"; riskUsd: number | null; timeframe?: string | null }

export interface HeatReport {
  openCount: number;
  totalRiskUsd: number;
  heatPct: number | null;          // total risk / trading balance
  longs: number; shorts: number;
  clusterNote: string | null;      // correlation warning
  limits: { maxHeatPct: number; maxOpen: number };
  level: "ok" | "caution" | "stop";
  messages: string[];
}

const MAJORS = new Set(["BTC", "ETH"]);

export function portfolioHeat(open: OpenTrade[], tradingBalanceUsd: number | null, limits = { maxHeatPct: 3, maxOpen: 3 }): HeatReport {
  const totalRiskUsd = open.reduce((s, t) => s + (t.riskUsd ?? 0), 0);
  const heatPct = tradingBalanceUsd ? +(100 * totalRiskUsd / tradingBalanceUsd).toFixed(2) : null;
  const longs = open.filter((t) => t.side === "LONG").length;
  const shorts = open.length - longs;
  const alts = open.filter((t) => !MAJORS.has(t.symbol.toUpperCase()));
  const altLongs = alts.filter((t) => t.side === "LONG").length;
  const altShorts = alts.length - altLongs;
  let clusterNote: string | null = null;
  if (altLongs >= 2 || altShorts >= 2) clusterNote = `${Math.max(altLongs, altShorts)} ${altLongs >= altShorts ? "longs" : "shorts"} on altcoins at once: altcoins move together with BTC most days, so this behaves like one larger ${altLongs >= altShorts ? "long" : "short"} on the market, not ${Math.max(altLongs, altShorts)} independent trades.`;
  const messages: string[] = [];
  let level: HeatReport["level"] = "ok";
  if (heatPct != null && heatPct > limits.maxHeatPct) { level = "stop"; messages.push(`Total risk ${heatPct}% of the account is above your ${limits.maxHeatPct}% limit: if every stop hits today you lose ${heatPct}%. Close or do not add trades.`); }
  else if (heatPct != null && heatPct > limits.maxHeatPct * 0.66) { level = "caution"; messages.push(`Total risk ${heatPct}% of the account: close to the ${limits.maxHeatPct}% limit.`); }
  if (open.length >= limits.maxOpen) { level = level === "stop" ? "stop" : "caution"; messages.push(`${open.length} open trades: at your limit of ${limits.maxOpen}. More positions means less attention per trade, not more edge.`); }
  if (clusterNote) { if (level === "ok") level = "caution"; messages.push(clusterNote); }
  if (!messages.length) messages.push(open.length ? `Total risk ${heatPct != null ? heatPct + "% of the account" : "$" + totalRiskUsd.toFixed(2)} across ${open.length} trade${open.length > 1 ? "s" : ""}: within limits.` : "No open trades: full risk budget available.");
  return { openCount: open.length, totalRiskUsd, heatPct, longs, shorts, clusterNote, limits, level, messages };
}

/** What adding a new trade would do to the heat. */
export function heatIfAdded(open: OpenTrade[], add: OpenTrade, balance: number | null, limits?: { maxHeatPct: number; maxOpen: number }) {
  return portfolioHeat([...open, add], balance, limits);
}
