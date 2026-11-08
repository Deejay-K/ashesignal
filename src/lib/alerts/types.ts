// Shared alert type definitions (safe to import from client code).

export const ALERT_TYPES = [
  { type: "price_above", label: "Price above", params: ["price"] },
  { type: "price_below", label: "Price below", params: ["price"] },
  { type: "pct_move", label: "Moves ±% within a candle window", params: ["pct", "bars"] },
  { type: "rsi_above", label: "RSI above", params: ["rsi"] },
  { type: "rsi_below", label: "RSI below", params: ["rsi"] },
  { type: "macd_cross", label: "MACD cross (either direction)", params: [] },
  { type: "pattern", label: "Pattern completes (any)", params: [] },
  { type: "breakout", label: "Breakout above tested level", params: [] },
  { type: "breakdown", label: "Breakdown below tested level", params: [] },
  { type: "tp", label: "Take-profit level reached", params: ["price"] },
  { type: "sl", label: "Stop-loss level reached", params: ["price"] },
  { type: "volume_spike", label: "Volume ≥ N× average", params: ["ratio"] },
  { type: "sentiment_zone", label: "Fear & Greed enters zone", params: ["zone"] },
  { type: "liquidity_change", label: "DEX liquidity changes ±% (24h)", params: ["pct"] },
  { type: "new_listing", label: "New token listings (global)", params: [] },
  { type: "macro_event", label: "High-impact macro event within 2 h (global)", params: [] },
  { type: "whale_transfer", label: "Whale transfer on a DEX token (>= $ amount)", params: ["usd"] },
  { type: "new_confirmed", label: "New Confirmed Trade appears (global, filtered)", params: [] },
  { type: "trade_update", label: "Journal trade reaches a target or stop (automatic)", params: [] },
  { type: "spot_zone", label: "Spot pick enters its accumulation zone (per coin)", params: [] },
] as const;
export type AlertType = (typeof ALERT_TYPES)[number]["type"];
