import { getFearGreed } from "@/lib/providers/feargreed";
import { getKlines } from "@/lib/providers/binance";
import { safe } from "@/lib/fetch";
import FngGauge from "@/components/FngGauge";
import FngChart from "@/components/FngChart";
import { Disclaimer, Empty, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SentimentPage() {
  const [f, btc] = await Promise.all([safe(getFearGreed(730)), safe(getKlines("BTCUSDT", "1d", 730))]);
  if (!f.ok) return <Empty>Fear &amp; Greed unavailable: {f.error}</Empty>;
  const h = f.data;
  const now = h[h.length - 1];
  const last30 = h.slice(-30);
  const avg30 = last30.reduce((s, x) => s + x.value, 0) / last30.length;
  const extremeFearDays = h.filter((x) => x.value <= 24).length;
  const extremeGreedDays = h.filter((x) => x.value >= 76).length;
  const streak = (() => {
    let n = 0;
    for (let i = h.length - 1; i >= 0 && h[i].label === now.label; i--) n++;
    return n;
  })();

  let read: string;
  if (now.value <= 24) read = "Extreme Fear. Historically the index spends little time here; it has marked accumulation zones more often than the start of further collapse - but it can stay extreme for weeks during true bear markets. Pair with a daily-chart bullish reversal pattern before acting.";
  else if (now.value <= 44) read = "Fear. Sentiment is negative but not capitulating. Pullback longs on strong assets have an edge if the higher-timeframe trend is still up; otherwise this is often the middle of a correction.";
  else if (now.value <= 55) read = "Neutral. Sentiment offers no edge - defer to technical structure.";
  else if (now.value <= 75) read = "Greed. Trend is being chased. Tighten stops on longs and favour taking partial profits at resistance.";
  else read = "Extreme Greed. The crowd is all-in; the index rarely stays here long. Overheated - treat new longs as counter-trend, watch for bearish divergences and blow-off volume.";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Market sentiment</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-1">
          <FngGauge history={h} />
          <p className="mt-3 text-sm text-fg-2">{read}</p>
          <div className="num mt-3 grid grid-cols-2 gap-2 text-xs text-fg-3">
            <span>30d avg <b className="text-fg">{avg30.toFixed(0)}</b></span>
            <span>streak <b className="text-fg">{streak}d {now.label.toLowerCase()}</b></span>
            <span>extreme fear days (2y) <b className="text-fg">{extremeFearDays}</b></span>
            <span>extreme greed days (2y) <b className="text-fg">{extremeGreedDays}</b></span>
          </div>
        </div>
        <Section title="Fear & Greed vs BTC - 2 years" className="lg:col-span-2" right={<span className="pill pill-mint">alternative.me · binance</span>}>
          <FngChart fng={h} btc={btc.ok ? btc.data.map((c) => ({ time: c.time, close: c.close })) : []} />
          <p className="mt-2 text-xs text-fg-3">Shaded bands: red = extreme fear (≤24), green = extreme greed (≥76). Look for BTC bottoms forming inside red bands and tops inside green - that is the reversal use of this index.</p>
        </Section>
      </div>
      <Section title="Zones">
        <div className="grid gap-2 sm:grid-cols-5 text-sm">
          {[
            ["0-24", "Extreme Fear", "Capitulation. Accumulation watch; confirm with daily reversal patterns.", "#f0506e"],
            ["25-44", "Fear", "Corrective. Buy strength only with HTF trend intact.", "#f2a444"],
            ["45-55", "Neutral", "No sentiment edge; trade the chart.", "#9fb0c0"],
            ["56-75", "Greed", "Trend-following works; manage risk tighter.", "#7fd4b0"],
            ["76-100", "Extreme Greed", "Overheated. Partial profits; watch for divergences.", "#36bd94"],
          ].map(([range, label, text, col]) => (
            <div key={label} className="card-3 p-3" style={{ borderTop: `3px solid ${col}` }}>
              <div className="num text-xs text-fg-3">{range}</div>
              <div className="font-semibold">{label}</div>
              <p className="mt-1 text-xs text-fg-2">{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-3">Per-token sentiment: CoinGecko community vote % is shown on each token page; social-volume sentiment (LunarCrush / Santiment) is a paid data source and is planned for Stage 3.</p>
      </Section>
      <Disclaimer />
    </div>
  );
}
