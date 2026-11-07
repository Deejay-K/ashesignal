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
] as const;
export type AlertType = (typeof ALERT_TYPES)[number]["type"];
