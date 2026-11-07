// Multi-timeframe analysis for one asset + a consolidated verdict.

import type { Timeframe } from "@/lib/types";
import { analyzeTimeframe, type TimeframeAnalysis } from "@/lib/ta/analysis";
import { getOhlcv, type AssetRef } from "./ohlcv";

export const ANALYSIS_TFS: Timeframe[] = ["15m", "1h", "4h", "1d"];

export interface MultiTfAnalysis {
  timeframes: Record<
    string,
    TimeframeAnalysis | { unavailable: true; note: string }
  >;
  sources: Record<string, { source: string; quality: string; note?: string }>;
  consensus: {
    shortTerm: TimeframeAnalysis["outlook"] | "unavailable"; // 15m+1h
    longTerm: TimeframeAnalysis["outlook"] | "unavailable"; // 4h+1d
    alignment:
      | "aligned bullish"
      | "aligned bearish"
      | "conflicting"
      | "neutral"
      | "unavailable";
    summary: string;
    opportunityScore: number;
  };
  generatedAt: number;
}

export async function analyzeAsset(
  ref: AssetRef,
  tfs: Timeframe[] = ANALYSIS_TFS,
): Promise<MultiTfAnalysis> {
  const results = await Promise.all(
    tfs.map(async (tf) => {
      const o = await getOhlcv(ref, tf, 500);
      const a = o.candles.length ? analyzeTimeframe(tf, o.candles) : null;
      return { tf, o, a };
    }),
  );
  const timeframes: MultiTfAnalysis["timeframes"] = {};
  const sources: MultiTfAnalysis["sources"] = {};
  for (const r of results) {
    sources[r.tf] = {
      source: r.o.source,
      quality: r.o.quality,
      note: r.o.note,
    };
    timeframes[r.tf] = r.a ?? {
      unavailable: true,
      note: r.o.candles.length
        ? `Only ${r.o.candles.length} candles - need at least 60 for reliable analysis.`
        : (r.o.note ?? "No data."),
    };
  }
  const get = (tf: Timeframe) => {
    const x = timeframes[tf];
    return x && !("unavailable" in x) ? x : null;
  };
  const avg = (xs: (TimeframeAnalysis | null)[]) => {
    const v = xs.filter((x): x is TimeframeAnalysis => !!x);
    return v.length ? v.reduce((s, x) => s + x.score, 0) / v.length : null;
  };
  const st = avg([get("15m"), get("1h")]);
  const lt = avg([get("4h"), get("1d")]);
  const toOutlook = (
    s: number | null,
  ): MultiTfAnalysis["consensus"]["shortTerm"] =>
    s == null
      ? "unavailable"
      : s >= 45
        ? "strongly bullish"
        : s >= 15
          ? "bullish"
          : s <= -45
            ? "strongly bearish"
            : s <= -15
              ? "bearish"
              : "neutral";
  const shortTerm = toOutlook(st);
  const longTerm = toOutlook(lt);
  let alignment: MultiTfAnalysis["consensus"]["alignment"] = "unavailable";
  if (st != null && lt != null) {
    if (st >= 15 && lt >= 15) alignment = "aligned bullish";
    else if (st <= -15 && lt <= -15) alignment = "aligned bearish";
    else if ((st >= 15 && lt <= -15) || (st <= -15 && lt >= 15))
      alignment = "conflicting";
    else alignment = "neutral";
  } else if (st != null || lt != null) {
    const s = (st ?? lt)!;
    alignment =
      s >= 15 ? "aligned bullish" : s <= -15 ? "aligned bearish" : "neutral";
  }
  const all = Object.values(timeframes).filter(
    (x): x is TimeframeAnalysis => !("unavailable" in x),
  );
  const opportunityScore = all.length
    ? Math.round(all.reduce((s, x) => s + x.opportunityScore, 0) / all.length)
    : 0;

  let summary: string;
  if (alignment === "unavailable")
    summary = "Not enough candle history to form a view.";
  else if (alignment === "conflicting")
    summary = `Timeframes disagree: ${shortTerm} on 15m/1h but ${longTerm} on 4h/1d. Lower-timeframe setups are counter-trend - size down and take profits quickly, or wait for the higher timeframe to turn.`;
  else if (alignment === "aligned bullish")
    summary = `Bullish across timeframes (short-term ${shortTerm}, long-term ${longTerm}). Pullback longs toward support have the trend behind them.`;
  else if (alignment === "aligned bearish")
    summary = `Bearish across timeframes (short-term ${shortTerm}, long-term ${longTerm}). Rallies into resistance are candidates for shorts or exits.`;
  else
    summary = `No strong edge: short-term ${shortTerm}, long-term ${longTerm}. Wait for a confirmed break of a key level.`;

  return {
    timeframes,
    sources,
    consensus: { shortTerm, longTerm, alignment, summary, opportunityScore },
    generatedAt: Date.now(),
  };
}
