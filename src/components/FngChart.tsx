"use client";

import { useEffect, useRef } from "react";
import { LineSeries, AreaSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import type { FearGreedPoint } from "@/lib/types";
import { palette } from "@/lib/themes";

export default function FngChart({ fng, btc }: { fng: FearGreedPoint[]; btc: { time: number; close: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const pal = palette();
    const chart = createChart(ref.current, {
      height: 300,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: pal.fg2, fontSize: 11 },
      grid: { vertLines: { color: pal.bg3 }, horzLines: { color: pal.bg3 } },
      rightPriceScale: { borderColor: pal.border },
      leftPriceScale: { visible: true, borderColor: pal.border },
      timeScale: { borderColor: pal.border },
    });
    const f = chart.addSeries(AreaSeries, { priceScaleId: "left", lineColor: pal.amber, topColor: pal.amber + "40", bottomColor: pal.amber + "00", lineWidth: 1, priceLineVisible: false });
    const day = (t: number) => (Math.floor(t / 86400) * 86400) as UTCTimestamp;
    const dedup = new Map<number, number>();
    fng.forEach((p) => dedup.set(day(p.timestamp), p.value));
    f.setData([...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    f.createPriceLine({ price: 24, color: pal.red + "99", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    f.createPriceLine({ price: 76, color: pal.mint + "99", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    chart.priceScale("left").applyOptions({ autoScale: false });
    if (btc.length) {
      const b = chart.addSeries(LineSeries, { color: pal.blue, lineWidth: 2, priceLineVisible: false });
      b.setData(btc.map((p) => ({ time: p.time as UTCTimestamp, value: p.close })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [fng, btc]);
  return <div ref={ref} className="w-full" />;
}
