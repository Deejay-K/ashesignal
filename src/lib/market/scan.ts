// Token address scanner: chain detection → DEX pairs → security → TA report.

import {
  classifyAddress,
  chainById,
  GECKOTERMINAL_NETWORK,
} from "@/lib/providers/chains";
import * as dex from "@/lib/providers/dexscreener";
import * as goplus from "@/lib/providers/goplus";
import { safe } from "@/lib/fetch";
import type { DexPair, Timeframe } from "@/lib/types";
import { analyzeAsset, type MultiTfAnalysis } from "./analyze";
import { whaleWatch, type WhaleReport } from "./whales";

export interface ScanReport {
  address: string;
  family: "evm" | "solana" | "unknown";
  chain: { id: string; name: string; explorer?: string } | null;
  token: {
    name: string;
    symbol: string;
    image?: string;
    websites?: string[];
    socials?: { type: string; url: string }[];
  } | null;
  market: {
    priceUsd: number | null;
    priceQuality: "verified" | "estimated" | "unavailable";
    liquidityUsd: number | null;
    fdv: number | null;
    marketCap: number | null;
    volume24h: number | null;
    change: {
      m5: number | null;
      h1: number | null;
      h6: number | null;
      h24: number | null;
    };
    buySellRatio24h: number | null;
    txns24h: number;
    pairCount: number;
    ageHours: number | null;
    note: string;
  };
  pairs: DexPair[];
  security: goplus.SecurityReport | null;
  securityNote: string;
  tradingActivity: { flags: string[] };
  analysis: MultiTfAnalysis | null;
  analysisNote: string;
  whales: WhaleReport | null;
  verdict: {
    riskLevel: "low" | "medium" | "high" | "extreme";
    summary: string;
  };
  generatedAt: number;
}

export async function scanAddress(
  raw: string,
  tfs?: Timeframe[],
): Promise<ScanReport> {
  const address = raw.trim();
  const family = classifyAddress(address);
  const base: ScanReport = {
    address,
    family,
    chain: null,
    token: null,
    market: {
      priceUsd: null,
      priceQuality: "unavailable",
      liquidityUsd: null,
      fdv: null,
      marketCap: null,
      volume24h: null,
      change: { m5: null, h1: null, h6: null, h24: null },
      buySellRatio24h: null,
      txns24h: 0,
      pairCount: 0,
      ageHours: null,
      note: "",
    },
    pairs: [],
    security: null,
    securityNote: "",
    tradingActivity: { flags: [] },
    analysis: null,
    analysisNote: "",
    whales: null,
    verdict: { riskLevel: "extreme", summary: "" },
    generatedAt: Date.now(),
  };
  if (family === "unknown") {
    base.market.note =
      "Address format not recognised. Supported: EVM (0x…, 40 hex) and Solana (base58 mint).";
    base.verdict.summary = "Could not identify this address.";
    return base;
  }

  const pairsR = await safe(dex.getPairsByToken(address));
  const pairs = pairsR.ok ? pairsR.data : [];
  base.pairs = pairs.slice(0, 15);
  if (!pairs.length) {
    base.market.note = pairsR.ok
      ? "No DEX pairs found on DexScreener for this address - token may be unlisted, brand new, or not a token contract."
      : "DexScreener unavailable: " + pairsR.error;
    base.verdict.summary = "No market data found for this address.";
  }

  const main = pairs[0];
  const chainId = main?.chainId ?? (family === "solana" ? "solana" : null);
  const chain = chainId ? chainById(chainId) : undefined;
  base.chain = chainId
    ? { id: chainId, name: chain?.name ?? chainId, explorer: chain?.explorer }
    : null;

  if (main) {
    const isBase =
      main.baseToken.address.toLowerCase() === address.toLowerCase();
    const tok = isBase ? main.baseToken : main.quoteToken;
    base.token = {
      name: tok.name,
      symbol: tok.symbol,
      image: main.info?.imageUrl,
      websites: main.info?.websites,
      socials: main.info?.socials,
    };
    const liq = pairs.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);
    const vol = pairs.reduce((s, p) => s + (p.volume.h24 ?? 0), 0);
    const buys = pairs.reduce((s, p) => s + p.txns.h24.buys, 0);
    const sells = pairs.reduce((s, p) => s + p.txns.h24.sells, 0);
    // liquidity-weighted price across pools
    const wp = pairs
      .filter((p) => p.priceUsd != null && p.liquidityUsd)
      .reduce((s, p) => s + p.priceUsd! * p.liquidityUsd!, 0);
    const wl = pairs
      .filter((p) => p.priceUsd != null && p.liquidityUsd)
      .reduce((s, p) => s + p.liquidityUsd!, 0);
    base.market = {
      priceUsd: wl ? wp / wl : main.priceUsd,
      priceQuality: pairs.length > 1 ? "estimated" : "verified",
      liquidityUsd: liq,
      fdv: main.fdv,
      marketCap: main.marketCap,
      volume24h: vol,
      change: main.priceChange,
      buySellRatio24h: sells ? buys / sells : null,
      txns24h: buys + sells,
      pairCount: pairs.length,
      ageHours: main.pairCreatedAt
        ? (Date.now() - main.pairCreatedAt) / 3_600_000
        : null,
      note:
        pairs.length > 1
          ? `Price is liquidity-weighted across ${pairs.length} pools (DexScreener).`
          : "Price from the single DexScreener pool.",
    };

    // trading-activity heuristics
    const flags: string[] = [];
    if (liq > 0 && vol / liq > 5)
      flags.push(
        `24h volume is ${(vol / liq).toFixed(0)}× liquidity - wash trading or extreme churn possible.`,
      );
    if (sells > 0 && buys / sells > 4 && buys + sells > 200)
      flags.push(
        "Buy/sell ratio is heavily skewed to buys - can precede a dump by early holders.",
      );
    if (buys > 0 && sells / buys > 3)
      flags.push("Sells dominate buys over 24h - distribution in progress.");
    if (base.market.ageHours != null && base.market.ageHours < 24)
      flags.push(
        "Pair is less than 24h old - most rugs happen in the first day.",
      );
    if (liq > 0 && (main.fdv ?? 0) / liq > 100)
      flags.push(
        `FDV is ${((main.fdv ?? 0) / liq).toFixed(0)}× liquidity - thin float relative to valuation.`,
      );
    if (main.boosts)
      flags.push(
        `Token has ${main.boosts} active paid DexScreener boosts - promoted, not organic.`,
      );
    base.tradingActivity.flags = flags;
  }

  // security
  if (chain?.family === "evm" && chain.goplusChainId) {
    const s = await safe(goplus.evmTokenSecurity(chain.goplusChainId, address));
    if (s.ok) base.security = s.data;
    else base.securityNote = "GoPlus security check failed: " + s.error;
  } else if (family === "solana") {
    const s = await safe(goplus.solanaTokenSecurity(address));
    if (s.ok) base.security = s.data;
    else base.securityNote = "GoPlus Solana security check failed: " + s.error;
  } else {
    base.securityNote = chainId
      ? `No automated security provider for ${chain?.name ?? chainId} yet.`
      : "Chain unknown - security not checked.";
  }

  // technical analysis via the main pool (+ whale watch in parallel)
  const whaleP =
    main && chainId
      ? safe(whaleWatch(chainId, address, base.market.priceUsd))
      : null;
  if (main && chainId && GECKOTERMINAL_NETWORK[chainId]) {
    const a = await safe(
      analyzeAsset(
        {
          symbol: base.token?.symbol,
          pool: {
            network: GECKOTERMINAL_NETWORK[chainId],
            address: main.pairAddress,
          },
        },
        tfs,
      ),
    );
    if (a.ok) {
      base.analysis = a.data;
      const ok = Object.values(a.data.timeframes).some(
        (t) => !("unavailable" in t),
      );
      base.analysisNote = ok
        ? ""
        : "Not enough candle history for technical analysis yet.";
    } else base.analysisNote = "Analysis failed: " + a.error;
  } else if (main) {
    base.analysisNote = `Candle data not available for ${chain?.name ?? chainId} pools.`;
  }

  if (whaleP) {
    const w = await whaleP;
    base.whales = w.ok
      ? w.data
      : {
          available: false,
          note: w.error,
          thresholdUsd: 0,
          transfers: [],
          summary: {
            count: 0,
            inflowUsd: 0,
            outflowUsd: 0,
            netToExchangesUsd: 0,
            largestUsd: 0,
          },
        };
    if (
      base.whales.available &&
      base.whales.summary.netToExchangesUsd > 100_000 &&
      base.whales.summary.inflowUsd > base.whales.summary.outflowUsd * 1.5
    )
      base.tradingActivity.flags.push(
        `Whale flow: ${fmtK(base.whales.summary.netToExchangesUsd)} net moved to exchange wallets recently.`,
      );
  }

  // verdict
  const secScore = base.security?.riskScore ?? 40;
  const liq = base.market.liquidityUsd ?? 0;
  let risk: ScanReport["verdict"]["riskLevel"] = "low";
  if (
    secScore >= 60 ||
    liq < 25_000 ||
    base.security?.checks.some(
      (c) => c.key === "honeypot" && c.status === "fail",
    )
  )
    risk = "extreme";
  else if (
    secScore >= 25 ||
    liq < 150_000 ||
    base.tradingActivity.flags.length >= 2
  )
    risk = "high";
  else if (
    liq < 1_000_000 ||
    base.tradingActivity.flags.length === 1 ||
    !base.security
  )
    risk = "medium";
  const parts = [
    base.token
      ? `${base.token.name} (${base.token.symbol}) on ${base.chain?.name}.`
      : "",
    base.security ? base.security.summary : base.securityNote,
    base.tradingActivity.flags.length
      ? `${base.tradingActivity.flags.length} trading-activity flag${base.tradingActivity.flags.length > 1 ? "s" : ""}.`
      : "No unusual trading activity detected.",
    base.analysis ? base.analysis.consensus.summary : base.analysisNote,
  ].filter(Boolean);
  base.verdict = { riskLevel: risk, summary: parts.join(" ") };
  return base;
}

const fmtK = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
