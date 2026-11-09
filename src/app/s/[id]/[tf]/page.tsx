import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { analyzeAsset } from "@/lib/market/analyze";
import { getCoin } from "@/lib/providers/coingecko";
import { safe } from "@/lib/fetch";
import { fmtUsd } from "@/lib/format";
import { VENUE_COOKIE } from "@/lib/venue-pref";
import { isVenueId, venueListings, venuesFor, tradeLink, VENUE_META, DEFAULT_VENUE, type VenueId } from "@/lib/venues";
import { zoneStatus, preTradeChecks } from "@/lib/trade-check";
import { ensureEngineConfig } from "@/lib/engine-config";
import type { Timeframe } from "@/lib/types";
import OrderTicket from "@/components/OrderTicket";
import SetupActions from "./SetupActions";
import { Disclaimer } from "@/components/ui";

export const dynamic = "force-dynamic";
const TFS: Timeframe[] = ["15m", "1h", "4h", "1d", "1w"];

export async function generateMetadata({ params }: { params: Promise<{ id: string; tf: string }> }): Promise<Metadata> {
  const { id, tf } = await params;
  return { title: `${id.toUpperCase()} ${tf} setup · AsheSignal`, description: "Shareable setup page: chart, levels, zone status, pre-trade check and order ticket. Manual trading only." };
}

/**
 * Public, shareable page for one setup (the "Full card" link in Telegram). Everything a trader needs on one
 * screen: chart image with levels, entry zone status, the levels, why it qualifies, pre-trade check (guest
 * version), the order ticket and the actions. Nothing here places orders.
 */
export default async function SetupPage({ params }: { params: Promise<{ id: string; tf: string }> }) {
  const { id, tf: tfRaw } = await params;
  const tf = (TFS.includes(tfRaw as Timeframe) ? tfRaw : "4h") as Timeframe;
  await ensureEngineConfig();
  const jar = await cookies();
  const venue: VenueId = isVenueId(jar.get(VENUE_COOKIE)?.value) ? (jar.get(VENUE_COOKIE)!.value as VenueId) : DEFAULT_VENUE;
  const coin = await safe(getCoin(id));
  if (!coin.ok) return <div className="card p-6"><h1 className="text-lg font-semibold">Could not load {id}</h1><p className="mt-2 text-sm text-red">{coin.error}</p></div>;
  const c = coin.data;
  const a = await safe(analyzeAsset({ symbol: c.symbol, coingeckoId: c.id, venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null;
  const s = t && !("unavailable" in t) ? t.setup : null;
  const price = t && !("unavailable" in t) ? t.price : null;
  const listings = await venueListings();
  const listed = venuesFor(c.symbol, listings, venue);
  const vm = VENUE_META[venue];
  const z = s ? zoneStatus(price, s.entry, s.side) : null;
  const pre = s ? await safe(preTradeChecks({ symbol: c.symbol, side: s.side, kind: s.kind, price, entry: s.entry, stop: s.stopLosses[0]?.price ?? null, venue, riskUsd: null, confirmGaps: s.quality.confirmGaps, account: null })) : null;
  const chart = s ? `/api/chart?${new URLSearchParams({ symbol: c.symbol, id: c.id, tf, side: s.side, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), sl1: String(s.stopLosses[0]?.price ?? ""), sl2: String(s.stopLosses[1]?.price ?? "") })}` : `/api/chart?${new URLSearchParams({ symbol: c.symbol, id: c.id, tf })}`;
  const kindCls = s?.kind === "confirmed" ? "pill-mint" : s?.kind === "speculative" ? "pill-amber" : "pill-gray";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{c.name} <span className="text-fg-3">{c.symbol}</span></h1>
        <span className="pill pill-gray">{tf}</span>
        {s ? <><span className={`pill ${s.side === "LONG" ? "pill-mint" : "pill-red"}`}>{s.side}</span><span className={`pill ${kindCls}`}>{s.kind}</span><span className="pill pill-gray">conf {s.confidence}%</span><span className="pill pill-gray">{s.riskRewardTp2}R to TP2</span></> : <span className="pill pill-gray">no setup on {tf}</span>}
        {price != null ? <span className="num ml-auto text-sm text-fg-2">{fmtUsd(price)}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1 text-xs">{TFS.map((x) => <Link key={x} href={`/s/${c.id}/${x}`} className={`btn-ghost !py-1 ${x === tf ? "!border-mint !text-mint" : ""}`}>{x}</Link>)}</div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={chart} alt={`${c.symbol} ${tf} chart with levels`} className="w-full rounded-xl border border-border" />

      {t && !("unavailable" in t) ? (
        <div className="card p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>{t.outlook}</b><span className="text-fg-3">score {t.score > 0 ? "+" : ""}{t.score} · trend {t.trend.direction} · RSI {t.momentum.rsi.toFixed(0)} · volume {t.volume.ratio.toFixed(2)}x</span></div>
          {a.ok ? <p className="mt-1 text-fg-2">{a.data.consensus.summary}</p> : null}
          <p className="mt-1 text-xs text-fg-3">{listed.includes(venue) ? `Listed on ${vm.label} as ${vm.instrument(c.symbol, vm.quotes[0])}` : listed.length ? `Not on ${vm.label}; listed on ${listed.map((v) => VENUE_META[v].label).join(", ")}` : "No centralised exchange listing found"}{s?.side === "SHORT" && !vm.canShort ? ` · ${vm.label} is spot only: treat this SHORT as a sell or reduce signal.` : ""}</p>
        </div>
      ) : null}

      {s ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="card p-3 text-sm">
              <div className="mb-1 font-semibold">Levels</div>
              <div className="num space-y-0.5 text-xs">
                <div>Entry zone: <b>{fmtUsd(s.entry.low)} to {fmtUsd(s.entry.high)}</b>{z && z.state !== "unknown" ? <span className={`pill ml-2 ${z.tone === "up" ? "pill-mint" : z.tone === "down" ? "pill-red" : "pill-amber"}`}>{z.label}</span> : null}</div>
                {s.takeProfits.map((x) => <div key={x.label}>{x.label}: <b className="up">{fmtUsd(x.price)}</b> ({x.rr}R)</div>)}
                {s.stopLosses.map((x) => <div key={x.label}>{x.label}: <b className="down">{fmtUsd(x.price)}</b></div>)}
                <div>Leverage: {s.leverage.recommended}x suggested (max {s.leverage.maxSafe}x){vm.canShort ? "" : " · spot: 1x"}</div>
              </div>
              {z?.advice ? <p className="mt-2 text-xs text-fg-2">{z.advice}</p> : null}
            </div>
            <div className="card p-3 text-sm">
              <div className="mb-1 font-semibold">Why{s.kind !== "confirmed" ? " (and what is missing)" : ""}</div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg-2">
                {s.reasons.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
                {s.quality.confirmGaps.slice(0, 3).map((g, i) => <li key={`g${i}`} className="text-amber">Missing for Confirmed: {g}</li>)}
                {s.invalidation?.slice(0, 2).map((g, i) => <li key={`i${i}`}>Invalidated if: {g}</li>)}
              </ul>
            </div>
          </div>
          {pre?.ok ? (
            <div className={`rounded-xl border p-3 text-sm ${pre.data.verdict === "go" ? "border-mint/40 bg-mint-dim" : pre.data.verdict === "careful" ? "border-amber/40 bg-amber-dim" : "border-red/50 bg-red/10"}`}>
              <div className="font-semibold">Pre-trade check: {pre.data.verdict.toUpperCase()}. <span className="font-normal">{pre.data.summary}</span></div>
              <ul className="mt-1 space-y-0.5 text-xs text-fg-2">{pre.data.checks.map((k) => <li key={k.id}><span className={k.level === "ok" ? "text-mint" : k.level === "warn" ? "text-amber" : k.level === "fail" ? "text-red" : "text-fg-3"}>{k.level === "ok" ? "✓" : k.level === "warn" ? "!" : k.level === "fail" ? "✕" : "·"}</span> <b>{k.label}.</b> {k.detail}</li>)}</ul>
              <p className="mt-1 text-[11px] text-fg-3">Sign in and open "I took this trade" to add your heat check and size.</p>
            </div>
          ) : null}
          <SetupActions coin={{ id: c.id, symbol: c.symbol, name: c.name }} tf={tf} setup={s} venue={venue} tradeUrl={listed.includes(venue) ? tradeLink(venue, c.symbol) : listed[0] ? tradeLink(listed[0], c.symbol) : null} />
          <OrderTicket venue={venue} symbol={c.symbol} side={s.side} entry={s.entry.mid} stop={s.stopLosses[0]?.price ?? s.entry.low} tps={s.takeProfits.slice(0, 3).map((x) => x.price)} units={null} leverage={vm.canShort ? s.leverage.recommended : 1} />
        </>
      ) : (
        <div className="card p-3 text-sm text-fg-2">No tradeable setup on {tf} right now. Try another timeframe above, or open the <Link className="link" href={`/token/${c.id}?tf=${tf}`}>full analysis</Link>.</div>
      )}
      <p className="text-xs text-fg-3">Share this page: the link stays current; it re-analyses live each time it is opened. <Link className="link" href={`/token/${c.id}?tf=${tf}`}>Full analysis</Link> · <Link className="link" href="/opportunities">Trading Discovery</Link></p>
      <Disclaimer />
    </div>
  );
}
