"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ScanReport } from "@/lib/market/scan";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import { Disclaimer, Empty, QualityBadge, RiskBadge, Section, StatCard } from "@/components/ui";
import AnalysisPanel from "@/components/AnalysisPanel";
import { GECKOTERMINAL_NETWORK } from "@/lib/providers/chains";
import WatchButton from "@/components/WatchButton";

export default function ScannerPage() {
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}

function Scanner() {
  const sp = useSearchParams();
  const router = useRouter();
  const initial = sp.get("address") ?? "";
  const [addr, setAddr] = useState(initial);
  const [rep, setRep] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (a: string) => {
    if (!a.trim()) return;
    setLoading(true);
    setErr(null);
    setRep(null);
    try {
      const r = await fetch(`/api/scan?address=${encodeURIComponent(a.trim())}`);
      const j = await r.json();
      if (j.error) setErr(j.error);
      else setRep(j);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initial) {
      setAddr(initial);
      run(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Token address scanner</h1>
        <p className="text-sm text-fg-2">Paste any EVM (0x…) or Solana contract address. Chain is auto-detected from DEX listings; security via GoPlus; candles via GeckoTerminal.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/scanner?address=${encodeURIComponent(addr.trim())}`);
          run(addr);
        }}
      >
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… or Solana mint address" className="num" />
        <button className="btn" disabled={loading}>{loading ? "Scanning…" : "Scan"}</button>
      </form>
      {err ? <p className="text-sm text-red">{err}</p> : null}
      {loading ? <div className="h-40 animate-pulse rounded-lg bg-bg-3" /> : null}
      {rep ? <Report r={rep} /> : null}
      <Disclaimer />
    </div>
  );
}

function Report({ r }: { r: ScanReport }) {
  const m = r.market;
  const sec = r.security;
  return (
    <div className="space-y-4">
      <div className={`card border-l-4 p-4 ${r.verdict.riskLevel === "low" ? "border-mint" : r.verdict.riskLevel === "medium" ? "border-fg-3" : r.verdict.riskLevel === "high" ? "border-amber" : "border-red"}`}>
        <div className="flex flex-wrap items-center gap-2">
          {r.token?.image ? <img src={r.token.image} alt="" className="h-8 w-8 rounded-full" /> : null}
          <h2 className="text-lg font-bold">{r.token ? `${r.token.name} (${r.token.symbol})` : "Unknown token"}</h2>
          {r.chain ? <span className="pill pill-gray">{r.chain.name}</span> : null}
          <RiskBadge level={r.verdict.riskLevel} />
          {r.token ? <WatchButton id={`addr:${r.chain?.id}:${r.address}`} symbol={r.token.symbol} name={r.token.name} address={r.address} chain={r.chain?.id} /> : null}
          {r.chain?.explorer ? <a className="link ml-auto text-xs" target="_blank" rel="noreferrer" href={`${r.chain.explorer}${r.address}`}>explorer ↗</a> : null}
        </div>
        <p className="mt-2 text-sm text-fg-2">{r.verdict.summary}</p>
        <p className="num mt-1 break-all text-xs text-fg-3">{r.address}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Price" value={fmtUsd(m.priceUsd)} sub={<QualityBadge quality={m.priceQuality} source="dexscreener" note={m.note} />} />
        <StatCard label="Liquidity" value={fmtUsd(m.liquidityUsd, { compact: true })} sub={`${m.pairCount} pool${m.pairCount === 1 ? "" : "s"}`} />
        <StatCard label="Volume 24h" value={fmtUsd(m.volume24h, { compact: true })} sub={m.liquidityUsd ? `${((m.volume24h ?? 0) / m.liquidityUsd).toFixed(1)}× liquidity` : undefined} />
        <StatCard label="FDV / MC" value={fmtUsd(m.fdv, { compact: true })} sub={`MC ${fmtUsd(m.marketCap, { compact: true })}`} />
        <StatCard label="Txns 24h" value={m.txns24h.toLocaleString()} sub={m.buySellRatio24h != null ? `buy/sell ${m.buySellRatio24h.toFixed(2)}` : undefined} />
        <StatCard label="Pair age" value={m.ageHours != null ? (m.ageHours < 48 ? `${m.ageHours.toFixed(0)} h` : `${(m.ageHours / 24).toFixed(0)} d`) : "—"} sub={<span className="num">{["m5", "h1", "h6", "h24"].map((k) => <span key={k} className={`mr-1 ${pctClass(m.change[k as keyof typeof m.change])}`}>{k} {fmtPct(m.change[k as keyof typeof m.change], 0)}</span>)}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Security checks" right={sec ? <span className={`pill ${sec.riskScore >= 60 ? "pill-red" : sec.riskScore >= 25 ? "pill-amber" : "pill-mint"}`}>risk {sec.riskScore}/100 · goplus</span> : <span className="pill pill-gray">not verified</span>}>
          {sec ? (
            <>
              <p className="mb-2 text-sm text-fg-2">{sec.summary}</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {sec.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${c.status === "pass" ? "bg-mint" : c.status === "warn" ? "bg-amber" : c.status === "fail" ? "bg-red" : "bg-fg-3"}`} />
                    <span><b className="text-fg">{c.label}</b> <span className="text-fg-3">— {c.detail}</span></span>
                  </li>
                ))}
              </ul>
              <div className="num mt-3 text-xs text-fg-3">
                Holders {sec.holders.count?.toLocaleString() ?? "?"} · top-10 {sec.holders.top10Pct?.toFixed(1) ?? "?"}% · creator {sec.holders.creatorPct?.toFixed(1) ?? "?"}% · tax {sec.taxes.buyPct?.toFixed(1) ?? "?"}/{sec.taxes.sellPct?.toFixed(1) ?? "?"}%
              </div>
            </>
          ) : (
            <Empty>{r.securityNote || "Security data unavailable."}</Empty>
          )}
        </Section>
        <Section title="Trading activity & pools">
          {r.tradingActivity.flags.length ? (
            <ul className="mb-3 list-disc space-y-1 pl-4 text-sm text-amber">{r.tradingActivity.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
          ) : (
            <p className="mb-3 text-sm text-fg-3">No unusual activity flags.</p>
          )}
          <div className="max-h-56 overflow-auto">
            <table>
              <thead><tr><th>DEX</th><th>Pair</th><th className="text-right">Price</th><th className="text-right">Liq</th><th className="text-right">Vol 24h</th></tr></thead>
              <tbody>
                {r.pairs.map((p) => (
                  <tr key={p.pairAddress}>
                    <td>{p.dexId}</td>
                    <td className="text-fg-2">{p.baseToken.symbol}/{p.quoteToken.symbol} {p.url ? <a className="link" href={p.url} target="_blank" rel="noreferrer">↗</a> : null}</td>
                    <td className="num text-right">{fmtUsd(p.priceUsd)}</td>
                    <td className="num text-right text-fg-2">{fmtUsd(p.liquidityUsd, { compact: true })}</td>
                    <td className="num text-right text-fg-2">{fmtUsd(p.volume.h24, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {r.pairs[0] && r.chain && GECKOTERMINAL_NETWORK[r.chain.id] ? (
        <AnalysisPanel asset={{ symbol: r.token?.symbol, network: GECKOTERMINAL_NETWORK[r.chain.id], pool: r.pairs[0].pairAddress }} defaultTf="1h" title={`${r.pairs[0].baseToken.symbol}/${r.pairs[0].quoteToken.symbol} · ${r.pairs[0].dexId}`} />
      ) : (
        <Empty>{r.analysisNote || "No chartable pool."}</Empty>
      )}
    </div>
  );
}
