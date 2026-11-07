"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DiscoverItem, DiscoverResult } from "@/lib/market/discover";
import { fmtPct, fmtUsd, pctClass, timeAgo } from "@/lib/format";
import { Disclaimer, Empty, RiskBadge, Section } from "@/components/ui";
import type { LiquidityChange } from "@/lib/market/liquidity";

const CATS: {
  key: keyof Omit<DiscoverResult, "errors" | "generatedAt">;
  label: string;
  note: string;
}[] = [
  {
    key: "bullish",
    label: "Bullish setups",
    note: "4h analysis score ≥ +15 on Binance-listed top-40",
  },
  {
    key: "bearish",
    label: "Bearish breakdowns",
    note: "4h analysis score ≤ −15 on Binance-listed top-40",
  },
  { key: "trending", label: "Trending", note: "CoinGecko search trending" },
  {
    key: "dexTrending",
    label: "Trending DEX / memecoins",
    note: "GeckoTerminal trending pools - all chains",
  },
  {
    key: "newPools",
    label: "Newly launched",
    note: "Newest DEX pools - extreme risk by default",
  },
  {
    key: "unusualVolume",
    label: "Unusual volume",
    note: "24h turnover > 15% of market cap (Binance)",
  },
  {
    key: "gainers",
    label: "Gainers 24h",
    note: "Binance USDT pairs > $2M volume",
  },
  {
    key: "losers",
    label: "Losers 24h",
    note: "Binance USDT pairs > $2M volume",
  },
  {
    key: "recovering",
    label: "Recovering",
    note: "> 30% below ATH and up > 8% today",
  },
];

const RISKS = ["low", "medium", "high", "extreme"] as const;

export default function DiscoverPage() {
  const [d, setD] = useState<DiscoverResult | null>(null);
  const [liq, setLiq] = useState<{
    changes: LiquidityChange[];
    note?: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chain, setChain] = useState("all");
  const [risk, setRisk] = useState<Set<string>>(new Set(RISKS));
  const [minLiq, setMinLiq] = useState(0);
  const [minVol, setMinVol] = useState(0);
  const [minMove, setMinMove] = useState(0);
  const [capBand, setCapBand] = useState("all");

  const load = () =>
    fetch("/api/discover")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setD(j)))
      .catch((e) => setErr(String(e)));
  useEffect(() => {
    load();
    fetch("/api/liquidity")
      .then((r) => r.json())
      .then(setLiq)
      .catch(() => {});
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const chains = useMemo(() => {
    const s = new Set<string>();
    d?.dexTrending.forEach((i) => i.chain && s.add(i.chain));
    d?.newPools.forEach((i) => i.chain && s.add(i.chain));
    return [...s].sort();
  }, [d]);

  const filt = (items: DiscoverItem[]) =>
    items.filter((i) => {
      if (!risk.has(i.risk)) return false;
      if (chain !== "all" && i.chain && i.chain !== chain) return false;
      if (chain !== "all" && !i.chain) return false;
      if (minLiq && (i.liquidityUsd ?? Infinity) < minLiq) return false;
      if (minVol && (i.volume24hUsd ?? 0) < minVol) return false;
      if (minMove && Math.abs(i.change24hPct ?? 0) < minMove) return false;
      const cap = i.marketCapUsd ?? null;
      if (capBand === "micro" && !(cap != null && cap < 1e6)) return false;
      if (capBand === "small" && !(cap != null && cap >= 1e6 && cap < 1e8))
        return false;
      if (capBand === "mid" && !(cap != null && cap >= 1e8 && cap < 1e10))
        return false;
      if (capBand === "large" && !(cap != null && cap >= 1e10)) return false;
      return true;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Discover</h1>
          <p className="text-xs text-fg-3">
            {d
              ? `Updated ${timeAgo(d.generatedAt)} · refreshes every 2 min`
              : "Loading…"}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-auto sm:grid-cols-5">
          <label className="text-xs text-fg-3">
            Chain
            <select value={chain} onChange={(e) => setChain(e.target.value)}>
              <option value="all">all (DEX lists)</option>
              {chains.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-3">
            Market cap
            <select
              value={capBand}
              onChange={(e) => setCapBand(e.target.value)}
            >
              <option value="all">any</option>
              <option value="micro">micro &lt; $1M</option>
              <option value="small">small $1M–100M</option>
              <option value="mid">mid $100M–10B</option>
              <option value="large">large &gt; $10B</option>
            </select>
          </label>
          <label className="text-xs text-fg-3">
            Min liquidity $
            <input
              type="number"
              value={minLiq || ""}
              onChange={(e) => setMinLiq(Number(e.target.value))}
              placeholder="0"
            />
          </label>
          <label className="text-xs text-fg-3">
            Min 24h vol $
            <input
              type="number"
              value={minVol || ""}
              onChange={(e) => setMinVol(Number(e.target.value))}
              placeholder="0"
            />
          </label>
          <label className="text-xs text-fg-3">
            Min |24h move| %
            <input
              type="number"
              value={minMove || ""}
              onChange={(e) => setMinMove(Number(e.target.value))}
              placeholder="0"
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-fg-3">Risk:</span>
        {RISKS.map((r) => (
          <button
            key={r}
            className="btn-ghost"
            data-active={risk.has(r)}
            onClick={() =>
              setRisk((s) => {
                const n = new Set(s);
                if (n.has(r)) n.delete(r);
                else n.add(r);
                return n;
              })
            }
          >
            {r}
          </button>
        ))}
      </div>
      {err ? <p className="text-sm text-red">{err}</p> : null}
      {d?.errors.length ? (
        <p className="text-xs text-amber">
          Partial data - {d.errors.join(" · ")}
        </p>
      ) : null}

      <Section
        title="Significant liquidity changes (24h)"
        right={
          <span className="text-[11px] text-fg-3">
            DEX pools tracked by the worker · ±25% or more
          </span>
        }
      >
        {!liq ? (
          <div className="h-24 animate-pulse rounded-lg bg-bg-3" />
        ) : liq.changes.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Chain</th>
                  <th className="text-right">Liquidity</th>
                  <th className="text-right">Change</th>
                  <th className="text-right">Window</th>
                  <th className="text-right">Vol 24h</th>
                </tr>
              </thead>
              <tbody>
                {liq.changes
                  .filter((c) => chain === "all" || c.chain === chain)
                  .slice(0, 25)
                  .map((c) => (
                    <tr key={c.chain + c.pool}>
                      <td>
                        {c.tokenAddress ? (
                          <Link
                            href={`/scanner?address=${c.tokenAddress}`}
                            className="font-medium hover:text-mint"
                          >
                            {c.symbol ?? c.pool.slice(0, 8)}
                          </Link>
                        ) : (
                          c.symbol
                        )}
                      </td>
                      <td>
                        <span className="pill pill-gray">{c.chain}</span>
                      </td>
                      <td className="num text-right">
                        {fmtUsd(c.liquidityBefore, { compact: true })} →{" "}
                        {fmtUsd(c.liquidityNow, { compact: true })}
                      </td>
                      <td className={`num text-right ${pctClass(c.changePct)}`}>
                        {fmtPct(c.changePct, 0)}
                        {c.changePct < -50 ? (
                          <span className="pill pill-red ml-1">rug?</span>
                        ) : null}
                      </td>
                      <td className="num text-right text-fg-3">
                        ~{c.hours.toFixed(0)}h
                      </td>
                      <td className="num text-right text-fg-2">
                        {fmtUsd(c.volume24h, { compact: true })}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {liq.note ??
              "No pool moved ±25% in the tracked window yet - the worker needs ~24h of snapshots after deploy."}
          </Empty>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {CATS.map((c) => (
          <Section
            key={c.key}
            title={c.label}
            right={<span className="text-[11px] text-fg-3">{c.note}</span>}
          >
            {!d ? (
              <div className="h-32 animate-pulse rounded-lg bg-bg-3" />
            ) : (
              <ItemTable items={filt(d[c.key] as DiscoverItem[])} />
            )}
          </Section>
        ))}
      </div>
      <Disclaimer />
    </div>
  );
}

function ItemTable({ items }: { items: DiscoverItem[] }) {
  if (!items.length) return <Empty>Nothing matches the current filters.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th className="text-right">Price</th>
            <th className="text-right">24h</th>
            <th className="text-right">Vol / Liq</th>
            <th>Why</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const href = it.id
              ? `/token/${it.id}`
              : it.address
                ? `/scanner?address=${it.address}`
                : `/token/${it.symbol.toLowerCase()}`;
            return (
              <tr
                key={(it.id ?? it.address ?? it.symbol) + i}
                className="hover:bg-bg-3"
              >
                <td>
                  <Link href={href} className="font-medium hover:text-mint">
                    {it.symbol}
                  </Link>
                  {it.chain ? (
                    <span className="pill pill-gray ml-1">{it.chain}</span>
                  ) : null}
                </td>
                <td className="num text-right">{fmtUsd(it.priceUsd)}</td>
                <td className={`num text-right ${pctClass(it.change24hPct)}`}>
                  {fmtPct(it.change24hPct, 1)}
                </td>
                <td className="num text-right text-fg-2">
                  {fmtUsd(it.volume24hUsd, { compact: true })}
                  {it.liquidityUsd != null
                    ? ` / ${fmtUsd(it.liquidityUsd, { compact: true })}`
                    : ""}
                </td>
                <td
                  className="max-w-[260px] truncate text-xs text-fg-3"
                  title={it.metric}
                >
                  {it.metric}
                </td>
                <td>
                  <RiskBadge level={it.risk} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
