import Link from "next/link";
import { getGlobal, getMarkets } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { discover } from "@/lib/market/discover";
import { safe } from "@/lib/fetch";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import TopCoins from "@/components/TopCoins";
import Headline from "@/components/Headline";
import TrackRecordSummary from "@/components/TrackRecordSummary";
import { Disclaimer, Empty, RiskBadge, Section, StatCard } from "@/components/ui";
import FngGauge from "@/components/FngGauge";
import WatchlistPreview from "@/components/WatchlistPreview";
import PortfolioCard from "@/components/PortfolioCard";
import MarketBriefing from "@/components/MarketBriefing";
import TradeConditions from "@/components/TradeConditions";
import Term from "@/components/Term";
import Fold from "@/components/Fold";
import Tour from "@/components/Tour";
import GettingStarted from "@/components/GettingStarted";
import { cookies } from "next/headers";
import { VENUE_COOKIE } from "@/lib/venue-pref";
import { DEFAULT_VENUE, VENUE_META, isVenueId, type VenueId } from "@/lib/venues";
import DiscoveryStrip from "@/components/DiscoveryStrip";
import RegimeCard from "@/components/RegimeCard";
import TodayPanel from "@/components/TodayPanel";
import type { DiscoverItem } from "@/lib/market/discover";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const jar = await cookies();
  const venue = isVenueId(jar.get(VENUE_COOKIE)?.value) ? (jar.get(VENUE_COOKIE)!.value as VenueId) : DEFAULT_VENUE;
  const [g, coins, fng, disc] = await Promise.all([safe(getGlobal()), safe(getMarkets(1, 100, true)), safe(getFearGreed(30)), safe(discover(venue))]);
  const ov = g.ok ? g.data : null;
  const f = fng.ok ? fng.data : [];
  const d = disc.ok ? disc.data : null;

  return (
    <div className="space-y-4">
      <Tour />
      {/* 1. Today: the answer first, then the six things to check, then the signal list and why it is empty. */}
      <Headline />
      <TodayPanel />
      <DiscoveryStrip />
      <GettingStarted />

      {/* 2. You: what you hold and what you follow. */}
      <Fold id="you" title="Your account" hint="portfolio and watchlist">
        <PortfolioCard />
        <WatchlistPreview />
      </Fold>

      {/* 3. The market: background for the headline above. */}
      <Fold id="market" title="Market right now" hint="size, sentiment, conditions, regime, briefing">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Total market cap" value={fmtUsd(ov?.totalMarketCapUsd.value, { compact: true })} sub={<span className={pctClass(ov?.marketCapChange24hPct.value)}>{fmtPct(ov?.marketCapChange24hPct.value)} 24h</span>} />
        <StatCard label="24h volume" value={fmtUsd(ov?.totalVolume24hUsd.value, { compact: true })} sub="all exchanges · CoinGecko" />
        <StatCard label={<Term id="dominance">BTC dominance</Term>} value={ov?.btcDominance.value != null ? `${ov.btcDominance.value.toFixed(1)}%` : "-"} />
        <StatCard label="ETH dominance" value={ov?.ethDominance.value != null ? `${ov.ethDominance.value.toFixed(1)}%` : "-"} />
        <div className="col-span-2 card p-4">
          {f.length ? <FngGauge history={f} compact /> : <Empty>Fear &amp; Greed unavailable</Empty>}
        </div>
      </div>
      {!g.ok ? <p className="text-xs text-red">Market overview unavailable: {g.error}</p> : null}
        <TradeConditions compact />
        <RegimeCard />
        <MarketBriefing />
      </Fold>

      <Fold id="ideas" title="Ideas and movers" hint="strongest and weakest charts, trending, gainers and losers">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={`Top bullish (4h, ${VENUE_META[d?.venue ?? venue].label} top-40)`} right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={d?.bullish ?? []} empty={d ? (d.breadth.analyzed ? `None of the ${d.breadth.analyzed} top coins checked is bullish on 4h (score +15 or more): ${d.breadth.bearish} bearish, ${d.breadth.neutral} neutral. Longs are low odds right now; waiting is fine.` : "The 4h scan returned no data from the exchange just now. Reload in a minute.") : undefined} />
        </Section>
        <Section title={`Top bearish (4h, ${VENUE_META[d?.venue ?? venue].label} top-40)`} right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={d?.bearish ?? []} empty={d ? (d.breadth.analyzed ? `None of the ${d.breadth.analyzed} top coins checked is bearish on 4h (score -15 or less): ${d.breadth.bullish} bullish, ${d.breadth.neutral} neutral.` : "The 4h scan returned no data from the exchange just now. Reload in a minute.") : undefined} />
        </Section>
        <Section title="Trending" right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={(d?.trending ?? []).slice(0, 8)} empty="CoinGecko trending is unavailable right now, or only stablecoins and wrapped coins are trending." />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Biggest gainers 24h"><PickList items={(d?.gainers ?? []).slice(0, 6)} empty={MOVERS_EMPTY} /></Section>
        <Section title="Biggest losers 24h"><PickList items={(d?.losers ?? []).slice(0, 6)} empty={MOVERS_EMPTY} /></Section>
        <Section title="Unusual volume"><PickList items={(d?.unusualVolume ?? []).slice(0, 6)} empty="No real coin is trading between 15% and 100% of its market cap today. Quiet market." /></Section>
      </div>
      <p className="text-[11px] text-fg-3">Gainers, losers and unusual volume only show real coins above $20M market cap: no stablecoins, wrapped coins, tokenized stocks or micro-caps.{d ? ` Lists checked at ${new Date(d.generatedAt).toISOString().slice(11, 16)} UTC.` : ""}</p>
      {d?.errors.length ? <p className="text-xs text-amber">Some discovery sources failed: {d.errors.join(" · ")}</p> : null}
      </Fold>

      <TrackRecordSummary />

      <Fold id="top" title="Top coins" hint="by market cap">
      <Section title="Top coins by market cap" right={<span className="pill pill-mint">verified · coingecko</span>}>
        {coins.ok ? <TopCoins coins={coins.data} show={50} /> : <Empty>Coin list unavailable: {coins.error}</Empty>}
      </Section>
      </Fold>
      <Disclaimer />
    </div>
  );
}

const MOVERS_EMPTY = "No data from the exchange for this list right now. Reload in a minute.";

function PickList({ items, empty }: { items: DiscoverItem[]; empty?: string }) {
  if (!items.length) return <Empty>{empty ?? "Nothing qualifies right now."}</Empty>;
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => {
        const href = it.id ? `/token/${it.id}` : it.address ? `/scanner?address=${it.address}` : `/token/${it.symbol.toLowerCase()}`;
        return (
          <li key={(it.id ?? it.address ?? it.symbol) + it.metric} className="flex items-center gap-2 py-2 text-sm">
            <Link href={href} className="font-medium hover:text-mint">{it.symbol}</Link>
            <span className="truncate text-xs text-fg-3">{it.metric}</span>
            <span className={`num ml-auto ${pctClass(it.change24hPct)}`}>{fmtPct(it.change24hPct, 1)}</span>
            {it.risk !== "low" ? <RiskBadge level={it.risk} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
