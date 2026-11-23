"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Disclaimer, Empty } from "@/components/ui";
import WhyNone from "@/components/WhyNone";
import type { WhyNone as Why } from "@/lib/market/why";
import { timeAgo } from "@/lib/format";
import type { Opportunity, OppCategory } from "@/lib/market/opportunities";
import { RISK_ORDER } from "@/lib/market/opportunities";
import { VENUE_IDS, VENUE_META, type VenueId } from "@/lib/venues";
import { currentVenue, VENUE_EVENT } from "@/lib/venue-pref";
import OpportunityCard from "@/components/OpportunityCard";
import CategoryHistory from "@/components/CategoryHistory";

const TABS: { key: OppCategory; label: string; tone: string; blurb: string }[] = [
  { key: "confirmed", label: "Confirmed Trades", tone: "tab-green", blurb: "Setups that passed the engine's technical criteria with supporting evidence. Confirmed means the rules were met, not that the trade is safe or guaranteed." },
  { key: "watching", label: "Watching", tone: "tab-blue", blurb: "Structure is building but nothing has triggered yet. Each card says what the engine is watching and what must happen before it becomes a Confirmed Trade." },
  { key: "speculative", label: "Speculative", tone: "tab-amber", blurb: "Memecoins, new launches, micro caps and unusual-volume tokens. Higher upside, much higher risk. Nothing here is a confirmed setup." },
  { key: "spot", label: "Spot Investments", tone: "tab-violet", blurb: "Buy-and-hold candidates for the next cycle, scored on fundamentals, liquidity, tokenomics and cycle position. Scenarios instead of single predictions." },
];

type SortKey = "confidence" | "rr" | "volume" | "upside" | "risk" | "newest" | "updated";
const SORTS: { k: SortKey; label: string }[] = [
  { k: "confidence", label: "Highest confidence" }, { k: "rr", label: "Best risk/reward" }, { k: "volume", label: "Highest volume" },
  { k: "upside", label: "Biggest upside" }, { k: "risk", label: "Lowest risk" }, { k: "newest", label: "Newest" }, { k: "updated", label: "Recently updated" },
];

interface Filters { q: string; chain: string; mcap: string; liq: string; vol: string; side: string; bias: string; risk: string; tf: string; rrMin: number | null; confMin: number | null; tokenCat: string; tier: string }
const EMPTY: Filters = { q: "", chain: "", mcap: "", liq: "", vol: "", side: "", bias: "", risk: "", tf: "", rrMin: null, confMin: null, tokenCat: "", tier: "" };
const BANDS: Record<string, [number, number]> = { micro: [0, 10e6], small: [10e6, 300e6], mid: [300e6, 10e9], large: [10e9, Infinity] };
const LIQ: Record<string, [number, number]> = { thin: [0, 100e3], ok: [100e3, 5e6], deep: [5e6, Infinity] };
const VOL: Record<string, [number, number]> = { low: [0, 1e6], mid: [1e6, 100e6], high: [100e6, Infinity] };

function OpportunitiesInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === sp.get("cat"))?.key ?? "confirmed") as OppCategory;
  const [d, setD] = useState<{ items: Opportunity[]; updatedAt: number | null; counts?: Record<OppCategory, number>; note?: string; live?: string[]; why?: Why | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>("confidence");
  const [showHistory, setShowHistory] = useState(false);
  // Default to what the user can actually place on their exchange (same filter the Telegram bot uses); remembered.
  const [mine, setMineState] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem("as_opp_mine"); if (v != null) setMineState(v === "1"); } catch {} }, []);
  const setMine = (v: boolean) => { setMineState(v); try { localStorage.setItem("as_opp_mine", v ? "1" : "0"); } catch {} };
  const [venue, setVenueState] = useState<VenueId>("binance");
  useEffect(() => { setVenueState(currentVenue()); const on = () => setVenueState(currentVenue()); window.addEventListener(VENUE_EVENT, on); return () => window.removeEventListener(VENUE_EVENT, on); }, []);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/opportunities?cat=all").then((r) => r.json()).then((x) => { if (alive) setD(x); }).catch(() => {});
    load();
    (window as unknown as { __oppReload?: () => void }).__oppReload = load;
    const id = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => { setSort(tab === "spot" ? "confidence" : tab === "speculative" ? "updated" : "confidence"); }, [tab]);

  const all = useMemo(() => (d?.items ?? []).filter((i) => i.category === tab), [d, tab]);
  const chains = useMemo(() => [...new Set(all.map((i) => i.chain).filter(Boolean) as string[])].sort(), [all]);
  const venueOpts = useMemo(() => VENUE_IDS.filter((v) => all.some((i) => i.venues?.includes(v))).map((v) => [v, `${VENUE_META[v].label} (${all.filter((i) => i.venues?.includes(v)).length})`] as [string, string]), [all]);
  const tokenCats = useMemo(() => [...new Set(all.flatMap((i) => i.tokenCategories))].sort().slice(0, 40), [all]);
  const tfs = useMemo(() => [...new Set(all.map((i) => i.timeframe).filter(Boolean) as string[])], [all]);

  const items = useMemo(() => {
    const inBand = (v: number | null, b?: [number, number]) => !b || (v != null && v >= b[0] && v < b[1]);
    return all.filter((i) => {
      if (mine && i.category !== "speculative") {
        if (!i.venues?.includes(venue)) return false;
        if (i.side === "SHORT" && !VENUE_META[venue].canShort) return false;
      }
      if (f.q && !(`${i.symbol} ${i.name}`.toLowerCase().includes(f.q.toLowerCase()))) return false;
      if (f.chain && !(i.venues?.includes(f.chain as VenueId) || i.chain === f.chain)) return false;
      if (f.mcap && !inBand(i.marketCap, BANDS[f.mcap])) return false;
      if (f.liq && !inBand(i.liquidity, LIQ[f.liq])) return false;
      if (f.vol && !inBand(i.volume24h, VOL[f.vol])) return false;
      if (f.side && i.side !== f.side) return false;
      if (f.bias && i.bias !== f.bias) return false;
      if (f.risk && i.risk !== f.risk) return false;
      if (f.tf && i.timeframe !== f.tf) return false;
      if (f.rrMin != null && (i.rr ?? 0) < f.rrMin) return false;
      if (f.confMin != null && (i.confidence ?? 0) < f.confMin) return false;
      if (f.tokenCat && !i.tokenCategories.includes(f.tokenCat)) return false;
      if (f.tier && i.tier !== f.tier) return false;
      return true;
    }).sort((a, b) => {
      const n = (v: number | null) => (v == null ? -Infinity : v);
      switch (sort) {
        case "confidence": return n(b.confidence) - n(a.confidence);
        case "rr": return n(b.rr) - n(a.rr);
        case "volume": return n(b.volume24h) - n(a.volume24h);
        case "upside": return n(b.upsidePct) - n(a.upsidePct);
        case "risk": return RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || n(b.confidence) - n(a.confidence);
        case "newest": return Date.parse(b.firstSeen) - Date.parse(a.firstSeen);
        case "updated": return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      }
    });
  }, [all, f, sort, mine, venue]);

  const setTab = (k: OppCategory) => router.replace(`/opportunities?cat=${k}`, { scroll: false });
  const sel = (k: keyof Filters, opts: [string, string][], label: string) => (
    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-fg-3">{label}
      <select className="!py-1 text-xs normal-case tracking-normal" value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">Any</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const num = (k: "rrMin" | "confMin", label: string, ph: string) => (
    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-fg-3">{label}
      <input type="number" className="!py-1 w-20 text-xs" placeholder={ph} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) })} />
    </label>
  );
  const active = TABS.find((t) => t.key === tab)!;
  const tradeable = (i: Opportunity) => !mine || i.category === "speculative" || (i.venues?.includes(venue) && (VENUE_META[venue].canShort || i.side !== "SHORT"));
  // Numbers for every tab at all times, from the full list (not the tab's slice), with the same tradeable filter.
  const count = (k: OppCategory) => (d?.items ?? []).filter((i) => i.category === k && tradeable(i)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Trading Discovery</h1>
          <p className="text-xs text-fg-3">The engine re-grades every tracked token on each worker run and moves it between categories automatically{d?.updatedAt ? ` · updated ${timeAgo(d.updatedAt)}` : ""}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost text-xs" disabled={refreshing} onClick={async () => { setRefreshing(true); try { const r = await fetch("/api/opportunities?cat=all&live=1"); setD(await r.json()); } catch {} setRefreshing(false); }}>{refreshing ? "Scanning live…" : "Refresh live"}</button>
          <button className="btn-ghost text-xs" onClick={() => setShowHistory((s) => !s)}>{showHistory ? "Hide" : "Show"} category history</button>
        </div>
      </div>

      <div className="opp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`opp-tab ${t.tone} ${tab === t.key ? "opp-tab-active" : ""}`} onClick={() => setTab(t.key)}>
            <span className="opp-dot" />
            <span>{t.label}</span>
            <span className="num opp-count">{d ? count(t.key) : "…"}</span>
          </button>
        ))}
      </div>
      <p className={`rounded-lg border px-3 py-2 text-xs opp-blurb ${active.tone}`}>
        {tab === "speculative" ? <strong className="mr-1">Warning: speculative.</strong> : null}
        {tab === "confirmed" ? <strong className="mr-1">Green flag.</strong> : null}
        {active.blurb} Manual trading only: AsheSignal never places orders or touches funds.
        {d?.live?.includes(tab) ? <span className="mt-1 block text-fg-3">Live snapshot computed just now from current market data{tab === "confirmed" || tab === "watching" ? " (top 40 Binance coins, 4h and 1d)" : tab === "speculative" ? " (top trending DEX pools)" : " (top 12 coins by market cap)"}. The worker extends this to the full list as it runs; &quot;Refresh live&quot; recomputes on demand.</span> : null}
      </p>

      {showHistory ? <CategoryHistory /> : null}

      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-fg-3">Token
            <input className="!py-1 w-32 text-xs" placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </label>
          {tab === "speculative" ? sel("chain", chains.map((c) => [c, c]), "Blockchain") : sel("chain", venueOpts, "Listed on")}
          {sel("mcap", [["micro", "Micro < $10M"], ["small", "Small $10M - $300M"], ["mid", "Mid $300M - $10B"], ["large", "Large > $10B"]], "Market cap")}
          {sel("liq", [["thin", "Thin < $100k"], ["ok", "$100k - $5M"], ["deep", "Deep > $5M"]], "Liquidity")}
          {sel("vol", [["low", "< $1M"], ["mid", "$1M - $100M"], ["high", "> $100M"]], "Volume 24h")}
          {tab !== "spot" ? sel("side", [["LONG", "Long"], ["SHORT", "Short"]], "Direction") : null}
          {sel("bias", [["bullish", "Bullish"], ["bearish", "Bearish"], ["neutral", "Neutral"]], "Bias")}
          {sel("risk", [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["extreme", "Extreme"]], "Risk")}
          {tfs.length > 1 ? sel("tf", tfs.map((t) => [t, t]), "Timeframe") : null}
          {tab === "confirmed" || tab === "watching" ? num("rrMin", "Min R:R", "2") : null}
          {num("confMin", tab === "spot" ? "Min score" : "Min setup score", "60")}
          {tokenCats.length ? sel("tokenCat", tokenCats.map((c) => [c, c]), tab === "speculative" ? "Source" : "Token category") : null}
          {tab === "spot" ? sel("tier", [["established", "Established"], ["emerging", "Emerging"], ["speculative", "Speculative"]], "Tier") : null}
          <label className="ml-auto flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-fg-3">Sort
            <select className="!py-1 text-xs normal-case tracking-normal" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.filter((s) => !(tab === "spot" && s.k === "rr") && !(tab === "speculative" && s.k === "rr")).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
            </select>
          </label>
          {JSON.stringify(f) !== JSON.stringify(EMPTY) ? <button className="btn-ghost text-xs" onClick={() => setF(EMPTY)}>Clear</button> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-3">
          <span>{items.length} of {all.length} shown</span>
          {tab !== "speculative" ? <label className="flex items-center gap-1.5 text-xs text-fg-2"><input type="checkbox" className="w-auto" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only what I can trade on {VENUE_META[venue].label}{!VENUE_META[venue].canShort ? " (listed there, longs only: it cannot short)" : " (listed there)"}</label> : null}
        </div>
      </div>

      {d && tab === "confirmed" && d.why ? <WhyNone why={d.why} /> : null}
      {!d ? <div className="card h-40 animate-pulse"><div className="p-4 text-xs text-fg-3">Loading. If the worker has not filled this category yet, a live scan runs now (10 to 40 seconds).</div></div> : d.note ? <Empty>{d.note}</Empty> : !all.length && tab === "confirmed" && d.why ? null : !all.length ? (
        <Empty>
          Nothing in {active.label} yet. {tab === "confirmed" ? "That is normal in quiet markets: the engine only confirms when the criteria are met. Check Watching for setups that are close." : tab === "watching" ? "The worker fills this within about an hour of its first run." : tab === "speculative" ? "The speculative worker scans trending and new DEX pools every 5 minutes; cards appear after the first runs." : "The spot worker scores 5 coins per run over the top 150; the first tier fills within a couple of hours."}
        </Empty>
      ) : !items.length ? <Empty>No match for these filters.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((i) => <OpportunityCard key={i.id} o={i} />)}
        </div>
      )}
      <Disclaimer />
    </div>
  );
}

export default function OpportunitiesPage() {
  return <Suspense fallback={<div className="card h-40 animate-pulse" />}><OpportunitiesInner /></Suspense>;
}
