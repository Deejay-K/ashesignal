"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { palette } from "@/lib/themes";

export default function HistoryChart({ points }: { points: { date: string; totalUsd: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pal = palette();
    const chart = createChart(ref.current, { height: 220, autoSize: true, layout: { background: { color: "transparent" }, textColor: pal.fg2, fontSize: 11 }, grid: { vertLines: { color: pal.bg3 }, horzLines: { color: pal.bg3 } }, rightPriceScale: { borderColor: pal.border }, timeScale: { borderColor: pal.border } });
    const s = chart.addSeries(AreaSeries, { lineColor: pal.mint, topColor: pal.mint + "4d", bottomColor: pal.mint + "00", lineWidth: 2 });
    s.setData(points.map((p) => ({ time: (Date.parse(p.date) / 1000) as UTCTimestamp, value: p.totalUsd })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={ref} className="w-full" />;
}
