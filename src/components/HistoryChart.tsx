"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, createChart, type UTCTimestamp } from "lightweight-charts";

export default function HistoryChart({ points }: { points: { date: string; totalUsd: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { height: 220, autoSize: true, layout: { background: { color: "transparent" }, textColor: "#9fb0c0", fontSize: 11 }, grid: { vertLines: { color: "#161e27" }, horzLines: { color: "#161e27" } }, rightPriceScale: { borderColor: "#1f2a35" }, timeScale: { borderColor: "#1f2a35" } });
    const s = chart.addSeries(AreaSeries, { lineColor: "#36bd94", topColor: "rgba(54,189,148,0.3)", bottomColor: "rgba(54,189,148,0)", lineWidth: 2 });
    s.setData(points.map((p) => ({ time: (Date.parse(p.date) / 1000) as UTCTimestamp, value: p.totalUsd })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={ref} className="w-full" />;
}
