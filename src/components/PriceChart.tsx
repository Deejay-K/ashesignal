"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/types";
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

export default function PriceChart({
  candles,
  analysis,
  overlays = { ema20: true, ema50: true, levels: true, setup: true, patterns: true },
  height = 420,
}: {
  candles: Candle[];
  analysis?: TimeframeAnalysis | null;
  overlays?: ChartOverlays;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const el = ref.current;
    const chart = createChart(el, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#9fb0c0", fontFamily: "ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: "#161e27" }, horzLines: { color: "#161e27" } },
      rightPriceScale: { borderColor: "#1f2a35" },
      timeScale: { borderColor: "#1f2a35", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: "#36bd94",
      downColor: "#f0506e",
      borderVisible: false,
      wickUpColor: "#36bd94",
      wickDownColor: "#f0506e",
      priceFormat: { type: "price", precision: precisionFor(candles[candles.length - 1].close), minMove: minMoveFor(candles[candles.length - 1].close) },
    });
    candleSeries.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(54,189,148,0.35)" : "rgba(240,80,110,0.35)" })));

    const closes = candles.map((c) => c.close);
    const addLine = (vals: number[], color: string, width: 1 | 2 = 1, style = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(candles.map((c, i) => ({ time: c.time as UTCTimestamp, value: vals[i] })).filter((p) => Number.isFinite(p.value)));
    };
    if (overlays.ema20) addLine(ema(closes, 20), "#5aa7ff");
    if (overlays.ema50) addLine(ema(closes, 50), "#f2b544");
    if (overlays.sma200 && candles.length >= 200) addLine(sma(closes, 200), "#ffffff", 1, LineStyle.Dotted);
    if (overlays.bollinger) {
      const bb = bollinger(closes);
      addLine(bb.upper, "rgba(159,176,192,0.5)", 1, LineStyle.Dashed);
      addLine(bb.lower, "rgba(159,176,192,0.5)", 1, LineStyle.Dashed);
    }

    if (analysis) {
      if (overlays.levels) {
        for (const l of analysis.levels) {
          candleSeries.createPriceLine({ price: l.price, color: l.kind === "support" ? "rgba(54,189,148,0.6)" : "rgba(240,80,110,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${l.kind[0].toUpperCase()}${l.touches}` });
        }
      }
      if (overlays.setup && analysis.setup) {
        const s = analysis.setup;
        candleSeries.createPriceLine({ price: s.entry.mid, color: "#ffffff", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${s.side} entry` });
        s.takeProfits.forEach((tp) => candleSeries.createPriceLine({ price: tp.price, color: "#36bd94", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: tp.label }));
        s.stopLosses.forEach((sl) => candleSeries.createPriceLine({ price: sl.price, color: "#f0506e", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: sl.label }));
      }
      if (overlays.patterns) {
        for (const p of [...analysis.patterns.completed, ...analysis.patterns.forming]) {
          if (p.keyLevel) candleSeries.createPriceLine({ price: p.keyLevel, color: p.bias === "bullish" ? "rgba(54,189,148,0.9)" : "rgba(240,80,110,0.9)", lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: false, title: p.name.split(" ").map((w) => w[0]).join("") });
        }
      }
      for (const tl of analysis.trendlines) {
        const s = chart.addSeries(LineSeries, { color: tl.kind === "support" ? "rgba(54,189,148,0.8)" : "rgba(240,80,110,0.8)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData([
          { time: tl.from.time as UTCTimestamp, value: tl.from.price },
          { time: tl.to.time as UTCTimestamp, value: tl.to.price },
        ]);
      }
    }

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, analysis, overlays, height]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}

function precisionFor(p: number) {
  if (p >= 1000) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 6;
  return 10;
}
function minMoveFor(p: number) {
  return 1 / 10 ** precisionFor(p);
}
