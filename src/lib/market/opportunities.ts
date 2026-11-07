// Shared card shape for the trading discovery hub (server builds it, client filters/sorts it).

import type { SpecDetail } from "./speculative";
import type { SpotDetail } from "./spot";

export type OppCategory = "confirmed" | "watching" | "speculative" | "spot";
export type RiskLevel = "low" | "medium" | "high" | "extreme";

export interface Opportunity {
  id: string;                 // asset_key[|timeframe]
  assetKey: string;           // cg:<id> | addr:<chain>:<addr>
  category: OppCategory;
  symbol: string;
  name: string;
  chain: string | null;       // "binance" for CEX-screened coins, DEX chain id otherwise
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  side: "LONG" | "SHORT" | null;
  bias: "bullish" | "bearish" | "neutral";
  risk: RiskLevel;
  timeframe: string | null;
  rr: number | null;
  confidence: number | null;   // 0..100
  upsidePct: number | null;    // to TP2 / first profit zone / bull-range low
  tokenCategories: string[];
  firstSeen: string;           // ISO (category_since / first_seen)
  updatedAt: string;           // ISO
  href: string;                // detailed analysis page
  // category-specific payloads
  detail: Record<string, unknown> | null;        // confirmed/watching snapshot (coin_metrics.detail)
  spec: SpecDetail | null;
  spot: SpotDetail | null;
  tier: SpotDetail["tier"] | null;
  liquidityNote: string | null;
}

export const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 };
