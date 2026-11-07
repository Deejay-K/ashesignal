"use client";

import { useEffect, useRef } from "react";
import { LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { palette } from "@/lib/themes";

export default function EquityChart({ points }: { points: { time: number; r: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pal = palette();
    const chart = createChart(ref.current, { height: 160, autoSize: true, layout: { background: { color: "transparent" }, textColor: pal.fg2, fontSize: 11 }, grid: { vertLines: { color: pal.bg3 }, horzLines: { color: pal.bg3 } }, rightPriceScale: { borderColor: pal.border }, timeScale: { borderColor: pal.border } });
    const s = chart.addSeries(LineSeries, { color: points[points.length - 1].r >= 0 ? pal.mint : pal.red, lineWidth: 2, priceLineVisible: false, title: "cumulative R" });
    const dedup = new Map<number, number>();
    points.forEach((p) => dedup.set(p.time, p.r));
    s.setData([...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    s.createPriceLine({ price: 0, color: pal.fg3, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={ref} className="w-full" />;
}
