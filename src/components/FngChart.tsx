"use client";

import { useEffect, useRef } from "react";
import { LineSeries, AreaSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import type { FearGreedPoint } from "@/lib/types";

export default function FngChart({ fng, btc }: { fng: FearGreedPoint[]; btc: { time: number; close: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 300,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#9fb0c0", fontSize: 11 },
      grid: { vertLines: { color: "#161e27" }, horzLines: { color: "#161e27" } },
      rightPriceScale: { borderColor: "#1f2a35" },
      leftPriceScale: { visible: true, borderColor: "#1f2a35" },
      timeScale: { borderColor: "#1f2a35" },
    });
    const f = chart.addSeries(AreaSeries, { priceScaleId: "left", lineColor: "#f2b544", topColor: "rgba(242,181,68,0.25)", bottomColor: "rgba(242,181,68,0)", lineWidth: 1, priceLineVisible: false });
    const day = (t: number) => (Math.floor(t / 86400) * 86400) as UTCTimestamp;
    const dedup = new Map<number, number>();
    fng.forEach((p) => dedup.set(day(p.timestamp), p.value));
    f.setData([...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    f.createPriceLine({ price: 24, color: "rgba(240,80,110,0.6)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    f.createPriceLine({ price: 76, color: "rgba(54,189,148,0.6)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    chart.priceScale("left").applyOptions({ autoScale: false });
    if (btc.length) {
      const b = chart.addSeries(LineSeries, { color: "#5aa7ff", lineWidth: 2, priceLineVisible: false });
      b.setData(btc.map((p) => ({ time: p.time as UTCTimestamp, value: p.close })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [fng, btc]);
  return <div ref={ref} className="w-full" />;
}
