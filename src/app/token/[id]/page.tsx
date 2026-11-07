import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCoin } from "@/lib/providers/coingecko";
import { resolveSymbol } from "@/lib/providers/binance";
import { safe } from "@/lib/fetch";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import AnalysisPanel from "@/components/AnalysisPanel";
import AiBriefing from "@/components/AiBriefing";
import PriceBoard from "@/components/PriceBoard";
import WatchButton from "@/components/WatchButton";
import { Disclaimer, QualityBadge, Section, StatCard } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} analysis` };
}

export default async function TokenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await safe(getCoin(id));
  if (!r.ok) {
    if (/404/.test(r.error)) notFound();
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Could not load {id}</h1>
        <p className="mt-2 text-sm text-red">{r.error}</p>
        <p className="mt-2 text-sm text-fg-2">CoinGecko may be rate-limiting. Add a free demo key as <code>COINGECKO_API_KEY</code> to lift the limit.</p>
      </div>
    );
  }
  const c = r.data;
  const binanceSym = await safe(resolveSymbol(c.symbol));
  const hasCex = binanceSym.ok && !!binanceSym.data;
  const chains = Object.entries(c.platforms).filter(([k, v]) => k && v);
  const cexVol = c.tickers.reduce((s, t) => s + (t.volumeUsd ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {c.image ? <img src={c.image} alt="" className="h-10 w-10 rounded-full" /> : null}
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
            {c.name} <span className="text-fg-3">{c.symbol}</span>
            {c.marketCapRank ? <span className="pill pill-gray">#{c.marketCapRank}</span> : null}
            <WatchButton id={c.id} symbol={c.symbol} name={c.name} />
          </h1>
          <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-fg-3">
            {c.categories.slice(0, 4).map((k) => <span key={k} className="pill pill-gray">{k}</span>)}
          </div>
        </div>
        <div className="w-full sm:ml-auto sm:w-auto sm:text-right">
          <div className="num text-2xl font-semibold">{fmtUsd(c.priceUsd)}</div>
          <div className={`num text-sm ${pctClass(c.change24hPct)}`}>{fmtPct(c.change24hPct)} 24h</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Market cap" value={fmtUsd(c.marketCapUsd, { compact: true })} sub={`FDV ${fmtUsd(c.fdvUsd, { compact: true })}`} />
        <StatCard label="Volume 24h" value={fmtUsd(c.volume24hUsd, { compact: true })} sub={c.marketCapUsd ? `${(((c.volume24hUsd ?? 0) / c.marketCapUsd) * 100).toFixed(1)}% of cap` : undefined} />
        <StatCard label="7d / 30d" value={<span className={pctClass(c.change7dPct)}>{fmtPct(c.change7dPct, 1)}</span>} sub={<span className={pctClass(c.change30dPct)}>{fmtPct(c.change30dPct, 1)} 30d · {fmtPct(c.change1yPct, 0)} 1y</span>} />
        <StatCard label="From ATH" value={c.ath && c.priceUsd ? fmtPct(((c.priceUsd - c.ath) / c.ath) * 100, 1) : "—"} sub={`ATH ${fmtUsd(c.ath)}`} />
        <StatCard label="Supply" value={c.circulatingSupply ? `${(c.circulatingSupply / 1e6).toFixed(1)}M` : "—"} sub={c.maxSupply ? `${((c.circulatingSupply ?? 0) / c.maxSupply * 100).toFixed(0)}% of max` : "no max supply"} />
        <StatCard label="Community sentiment" value={c.sentimentUpPct != null ? `${c.sentimentUpPct.toFixed(0)}% 👍` : "—"} sub="CoinGecko votes" />
      </div>

      <AnalysisPanel asset={{ symbol: c.symbol, id: c.id }} title={hasCex ? `${binanceSym.data} · Binance` : `${c.symbol} · CoinGecko (no Binance pair)`} />

      <AiBriefing id={c.id} />

      <PriceBoard symbol={c.symbol} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Markets" right={<QualityBadge quality="verified" source="coingecko" />}>
          <p className="mb-2 text-xs text-fg-3">Top venues by 24h volume · CEX+DEX reported volume {fmtUsd(cexVol, { compact: true })}</p>
          <div className="max-h-72 overflow-auto">
            <table>
              <thead><tr><th>Exchange</th><th>Pair</th><th className="text-right">Price</th><th className="text-right">Vol 24h</th><th>Trust</th></tr></thead>
              <tbody>
                {c.tickers.sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0)).slice(0, 20).map((t, i) => (
                  <tr key={i}>
                    <td>{t.exchange}</td>
                    <td className="text-fg-2">{t.base.length > 12 ? t.base.slice(0, 6) + "…" : t.base}/{t.target.length > 12 ? t.target.slice(0, 6) + "…" : t.target}</td>
                    <td className="num text-right">{fmtUsd(t.lastUsd)}</td>
                    <td className="num text-right text-fg-2">{fmtUsd(t.volumeUsd, { compact: true })}</td>
                    <td><span className={`pill ${t.trustScore === "green" ? "pill-mint" : t.trustScore === "yellow" ? "pill-amber" : "pill-gray"}`}>{t.trustScore ?? "n/a"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="On-chain contracts">
          {chains.length ? (
            <ul className="space-y-1 text-sm">
              {chains.map(([chain, addr]) => (
                <li key={chain} className="flex items-center gap-2">
                  <span className="pill pill-gray">{chain}</span>
                  <span className="num truncate text-fg-2">{addr}</span>
                  <Link href={`/scanner?address=${addr}`} className="link ml-auto shrink-0 text-xs">scan →</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-3">Native coin — no contract address (security scan not applicable).</p>
          )}
          {c.description ? <p className="mt-4 line-clamp-6 text-xs text-fg-3">{c.description.replace(/<[^>]+>/g, "")}</p> : null}
          {c.homepage ? <a href={c.homepage} target="_blank" rel="noreferrer" className="link mt-2 inline-block text-xs">{c.homepage}</a> : null}
        </Section>
      </div>
      <Disclaimer />
    </div>
  );
}
