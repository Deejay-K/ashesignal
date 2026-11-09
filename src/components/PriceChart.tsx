"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Pattern } from "@/lib/ta/patterns";
import type { Candle } from "@/lib/types";
import { palette } from "@/lib/themes";
import { bollinger, ema, sma } from "@/lib/ta/indicators";
import type { TimeframeAnalysis } from "@/lib/ta/analysis";

export interface ChartOverlays {
  ema20?: boolean;
  ema50?: boolean;
  sma200?: boolean;
  bollinger?: boolean;
  levels?: boolean;
  setup?: boolean;
  patterns?: boolean;
}

let MINT = "#36bd94";
let RED = "#f0506e";
let GRAY = "#6b7a89";

/** Default set of pattern ids drawn on the chart: live (non-candlestick) patterns, strongest first, max 4. */
export function defaultVisiblePatterns(analysis?: TimeframeAnalysis | null): string[] {
  if (!analysis) return [];
  return analysis.patterns.all
    .filter((p) => p.family !== "candlestick" && (p.status === "confirmed" || p.status === "completed" || p.status === "forming"))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((p) => p.id);
}

export default function PriceChart({
  candles,
  analysis,
  overlays = { ema20: true, ema50: true, levels: true, setup: true, patterns: true },
  visiblePatterns,
  height = 420,
}: {
  candles: Candle[];
  analysis?: TimeframeAnalysis | null;
  overlays?: ChartOverlays;
  visiblePatterns?: string[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  if (typeof window !== "undefined" && window.innerWidth < 640) height = Math.min(height, 300);
  const seriesRef = useRef<{ candle: ISeriesApi<"Candlestick">; vol: ISeriesApi<"Histogram">; count: number; first: number } | null>(null);

  // Fast path: same series (same first candle, length within +1) → update the last bar only.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !candles.length) return;
    if (candles[0].time !== s.first || candles.length < s.count || candles.length > s.count + 1) return;
    const c = candles[candles.length - 1];
    s.candle.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    s.vol.update({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? MINT + "59" : RED + "59" });
    s.count = candles.length;
  }, [candles]);

  // Full rebuild only when the dataset, analysis or overlays actually change.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick((t) => t + 1);
    window.addEventListener("theme-change", on);
    return () => window.removeEventListener("theme-change", on);
  }, []);
  const rebuildKey = `${candles[0]?.time}|${analysis?.timeframe}|${analysis?.score}|${JSON.stringify(overlays)}|${(visiblePatterns ?? []).join(",")}|${height}|${themeTick}`;
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const el = ref.current;
    const pal = palette();
    MINT = pal.mint; RED = pal.red; GRAY = pal.fg3;
    const chart = createChart(el, {
      height,
      layout: { background: { color: "transparent" }, textColor: pal.fg2, fontFamily: "ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: pal.bg3 }, horzLines: { color: pal.bg3 } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border, timeVisible: true, secondsVisible: false, rightOffset: 14 },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: pal.mint,
      downColor: pal.red,
      borderVisible: false,
      wickUpColor: pal.mint,
      wickDownColor: pal.red,
      priceFormat: { type: "price", precision: precisionFor(candles[candles.length - 1].close), minMove: minMoveFor(candles[candles.length - 1].close) },
    });
    candleSeries.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? pal.mint + "59" : pal.red + "59" })));
    seriesRef.current = { candle: candleSeries, vol, count: candles.length, first: candles[0].time };

    const closes = candles.map((c) => c.close);
    const addLine = (vals: number[], color: string, width: 1 | 2 = 1, style = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: vals[i] })).filter((p) => Number.isFinite(p.value)));
    };
    if (overlays.ema20) addLine(ema(closes, 20), pal.blue);
    if (overlays.ema50) addLine(ema(closes, 50), pal.amber);
    if (overlays.sma200 && candles.length >= 200) addLine(sma(closes, 200), pal.fg, 1, LineStyle.Dotted);
    if (overlays.bollinger) {
      const bb = bollinger(closes);
      addLine(bb.upper, pal.fg2 + "80", 1, LineStyle.Dashed);
      addLine(bb.lower, pal.fg2 + "80", 1, LineStyle.Dashed);
    }

    if (analysis) {
      if (overlays.levels) {
        for (const l of analysis.levels) {
          candleSeries.createPriceLine({ price: l.price, color: l.kind === "support" ? pal.mint + "99" : pal.red + "99", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${l.kind[0].toUpperCase()}${l.touches}` });
        }
      }
      if (overlays.setup && analysis.setup) {
        const s = analysis.setup;
        candleSeries.createPriceLine({ price: s.entry.mid, color: pal.fg, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${s.side} entry` });
        s.takeProfits.forEach((tp) => candleSeries.createPriceLine({ price: tp.price, color: pal.mint, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: tp.label }));
        s.stopLosses.forEach((sl) => candleSeries.createPriceLine({ price: sl.price, color: pal.red, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: sl.label }));
      }
      if (overlays.patterns) {
        const ids = new Set(visiblePatterns ?? defaultVisiblePatterns(analysis));
        const markers: SeriesMarker<Time>[] = [];
        const candleTimes = new Set(candles.map((c) => c.time));
        const nearestTime = (t: number) => {
          if (candleTimes.has(t)) return t as UTCTimestamp;
          let best = candles[0].time;
          for (const c of candles) if (Math.abs(c.time - t) < Math.abs(best - t)) best = c.time;
          return best as UTCTimestamp;
        };
        for (const p of analysis.patterns.all) {
          if (!ids.has(p.id)) continue;
          const dead = p.status === "failed" || p.status === "invalidated";
          const color = dead ? GRAY : p.bias === "bullish" ? MINT : RED;
          const style = p.status === "forming" ? LineStyle.Dashed : dead ? LineStyle.Dotted : LineStyle.Solid;
          const width: 1 | 2 = p.status === "confirmed" || p.status === "completed" ? 2 : 1;
          for (const l of p.lines) {
            if (l.from.time === l.to.time) {
              // vertical / point-in-time line: render as a price line instead
              if (l.kind === "target" && p.target != null) candleSeries.createPriceLine({ price: p.target, color, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: `${short(p.name)} target` });
              continue;
            }
            const a = l.from.time < l.to.time ? l.from : l.to;
            const b = l.from.time < l.to.time ? l.to : l.from;
            const s = chart.addSeries(LineSeries, { color, lineWidth: l.kind === "target" ? 1 : width, lineStyle: l.kind === "target" ? LineStyle.SparseDotted : l.kind === "trigger" ? LineStyle.Dashed : style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            s.setData([{ time: a.time as UTCTimestamp, value: a.price }, { time: b.time as UTCTimestamp, value: b.price }]);
          }
          if (p.arc && p.arc.length > 2) {
            const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            s.setData(p.arc.map((x) => ({ time: x.time as UTCTimestamp, value: x.price })));
          }
          if (p.keyLevel != null && p.family !== "candlestick") candleSeries.createPriceLine({ price: p.keyLevel, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${short(p.name)} ${p.status === "forming" ? "trigger" : "break"}` });
          if (p.invalidation != null && p.status === "forming") candleSeries.createPriceLine({ price: p.invalidation, color: GRAY, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false, title: `${short(p.name)} invalid` });
          // labelled points (shoulders, XABCD, tops) + the pattern label + direction arrow
          for (const q of p.points) markers.push({ time: nearestTime(q.time), position: q.side === "above" ? "aboveBar" : "belowBar", color, shape: "circle", text: q.label, size: 0.6 } as SeriesMarker<Time>);
          const labelTime = nearestTime(p.startTime);
          markers.push({ time: labelTime, position: p.bias === "bullish" ? "belowBar" : "aboveBar", color, shape: "square", text: `${p.name} - ${p.status} ${Math.round(p.confidence * 100)}%`, size: 0.8 } as SeriesMarker<Time>);
          const arrowTime = nearestTime(p.endTime);
          markers.push({ time: arrowTime, position: p.bias === "bullish" ? "belowBar" : "aboveBar", color, shape: p.bias === "bullish" ? "arrowUp" : "arrowDown", text: p.bias === "bullish" ? "▲" : "▼", size: 1.2 } as SeriesMarker<Time>);
        }
        if (markers.length) {
          markers.sort((a, b) => (a.time as number) - (b.time as number));
          createSeriesMarkers(candleSeries, markers);
        }
      }
      for (const tl of analysis.trendlines) {
        const s = chart.addSeries(LineSeries, { color: tl.kind === "support" ? pal.mint + "cc" : pal.red + "cc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData([
          { time: tl.from.time as UTCTimestamp, value: tl.from.price },
          { time: tl.to.time as UTCTimestamp, value: tl.to.price },
        ]);
      }
    }

    // Leave empty space after the last candle (about 15% of the view) so the newest candles, pattern lines and the
    // TP / SL / level labels on the right never cover each other.
    const n = candles.length;
    if (n > 1) { const pad = Math.max(8, Math.round(n * 0.15)); chart.timeScale().setVisibleLogicalRange({ from: 0, to: n - 1 + pad }); }
    else chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildKey]);

  const exportPng = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const src = chart.takeScreenshot();
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height + 28;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = palette().bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = palette().fg3;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`AsheSignal${analysis ? ` · ${analysis.timeframe} · score ${analysis.score > 0 ? "+" : ""}${analysis.score}` : ""} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · not financial advice`, 8, out.height - 10);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `ashesignal-${analysis?.timeframe ?? "chart"}-${Date.now()}.png`;
    a.click();
  };
  return (
    <div className="relative">
      <div ref={ref} style={{ height }} className="w-full" />
      <button onClick={exportPng} className="btn-ghost absolute left-2 top-2 !py-1 text-[11px] opacity-70 hover:opacity-100" title="Download this chart as an image">PNG</button>
    </div>
  );
}

const short = (name: string) => name.split(/\s+/).map((w) => (/^(and|&|of)$/i.test(w) ? "" : w[0])).join("").toUpperCase();

function precisionFor(p: number) {
  if (p >= 1000) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 6;
  return 10;
}
function minMoveFor(p: number) {
  return 1 / 10 ** precisionFor(p);
}
