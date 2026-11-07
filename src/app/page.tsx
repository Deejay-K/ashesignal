import Link from "next/link";
import { getGlobal, getMarkets } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { discover } from "@/lib/market/discover";
import { safe } from "@/lib/fetch";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import CoinTable from "@/components/CoinTable";
import { Disclaimer, Empty, RiskBadge, Section, StatCard } from "@/components/ui";
import FngGauge from "@/components/FngGauge";
import WatchlistPreview from "@/components/WatchlistPreview";
import PortfolioCard from "@/components/PortfolioCard";
import MarketBriefing from "@/components/MarketBriefing";
import TradeConditions from "@/components/TradeConditions";
import Term from "@/components/Term";
import Welcome from "@/components/Welcome";
import { cookies } from "next/headers";
import { VENUE_COOKIE } from "@/lib/venue-pref";
import { DEFAULT_VENUE, VENUE_META, isVenueId, type VenueId } from "@/lib/venues";
import DiscoveryStrip from "@/components/DiscoveryStrip";
import type { DiscoverItem } from "@/lib/market/discover";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const jar = await cookies();
  const venue = isVenueId(jar.get(VENUE_COOKIE)?.value) ? (jar.get(VENUE_COOKIE)!.value as VenueId) : DEFAULT_VENUE;
  const [g, coins, fng, disc] = await Promise.all([safe(getGlobal()), safe(getMarkets(1, 50, true)), safe(getFearGreed(30)), safe(discover(venue))]);
  const ov = g.ok ? g.data : null;
  const f = fng.ok ? fng.data : [];
  const d = disc.ok ? disc.data : null;

  return (
    <div className="space-y-4">
      <Welcome />
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
      <DiscoveryStrip />
      <MarketBriefing />

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={`Top bullish (4h, ${VENUE_META[d?.venue ?? venue].label} top-40)`} right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={d?.bullish ?? []} />
        </Section>
        <Section title={`Top bearish (4h, ${VENUE_META[d?.venue ?? venue].label} top-40)`} right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={d?.bearish ?? []} />
        </Section>
        <Section title="Trending" right={<Link className="link text-xs" href="/discover">more →</Link>}>
          <PickList items={(d?.trending ?? []).slice(0, 8)} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Biggest gainers 24h"><PickList items={(d?.gainers ?? []).slice(0, 6)} /></Section>
        <Section title="Biggest losers 24h"><PickList items={(d?.losers ?? []).slice(0, 6)} /></Section>
        <Section title="Unusual volume"><PickList items={(d?.unusualVolume ?? []).slice(0, 6)} /></Section>
      </div>
      {d?.errors.length ? <p className="text-xs text-amber">Some discovery sources failed: {d.errors.join(" · ")}</p> : null}

      <PortfolioCard />
      <WatchlistPreview />

      <Section title="Top 50 by market cap" right={<span className="pill pill-mint">verified · coingecko</span>}>
        {coins.ok ? <CoinTable coins={coins.data} /> : <Empty>Coin list unavailable: {coins.error}</Empty>}
      </Section>
      <Disclaimer />
    </div>
  );
}

function PickList({ items }: { items: DiscoverItem[] }) {
  if (!items.length) return <Empty>Nothing qualifies right now.</Empty>;
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
