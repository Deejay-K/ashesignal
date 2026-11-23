"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sizePosition, type RiskInputs } from "@/lib/risk/position";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import CurrencyPicker from "@/components/CurrencyPicker";
import { useCurrency } from "@/lib/currency";
import { currentVenue } from "@/lib/venue-pref";
import { VENUE_META } from "@/lib/venues";

const KEY = "ashesignal.risk.profile.v1";
const MODE_KEY = "ashesignal.risk.mode.v1";

export default function RiskPage() {
  return (
    <Suspense>
      <Risk />
    </Suspense>
  );
}

/* Every field keeps its raw text while you type (so "0.0063" can be typed digit by digit) and is parsed for the math. */
type Cap = { tradingBalance: string; portfolioValue: string; riskPct: string; maxLossUsd: string; maxExposurePct: string; leverage: string; feePct: string };
type Trade = { side: "LONG" | "SHORT"; entry: string; stop: string; tp1: string; tp2: string; tp3: string };
const numOf = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : 0; };

const HELP: Record<keyof Cap, { label: string; what: string; example: string }> = {
  tradingBalance: { label: "Trading balance", what: "The money you actually trade with on the exchange. Not your savings, not your whole portfolio: only what sits in the trading account.", example: "You have $5,000 on Kraken for trading: enter 5000." },
  riskPct: { label: "Risk per trade %", what: "How much of the trading balance you accept to lose if this one trade hits its stop. This single number decides the position size. 1% is the standard; 0.5% while learning; above 2% is aggressive.", example: "1% of $5,000 = $50 is the most this trade can lose." },
  leverage: { label: "Leverage", what: "1 = spot (you buy the coin, no borrowing). Above 1 = futures or margin: the exchange lends you the rest. It does NOT change how much you lose at the stop (that is fixed by Risk %); it changes how much of your balance is locked as margin and how close the liquidation is.", example: "Setup cards show a recommended leverage; leave 1 if you trade spot." },
  portfolioValue: { label: "Total portfolio", what: "Optional. Everything you own in crypto (exchange + wallets + holdings). Only used to show what share of your whole portfolio this trade represents.", example: "$5,000 trading + $5,000 long-term holdings = 10000." },
  maxLossUsd: { label: "Max loss per trade", what: "Optional hard cap in money. If Risk % works out to more than this, the cap wins. Useful when the balance grows and 1% starts to feel large.", example: "Enter 40 to never lose more than $40 on one trade." },
  maxExposurePct: { label: "Max exposure %", what: "Optional. The biggest position (in value, not in risk) you allow as a share of the trading balance. Stops a very tight stop from producing a huge position.", example: "25 means no single position is worth more than 25% of the balance." },
  feePct: { label: "Round-trip fee %", what: "What the exchange charges to open plus close, in percent of the position value. Taker fees on most exchanges are about 0.1% each way, so 0.2 round trip. It is subtracted from every profit figure.", example: "Binance/OKX/Bybit taker: 0.2. Kraken Pro: 0.5 to 0.8. Coinbase Advanced: 1.2 or more." },
};

function Risk() {
  const sp = useSearchParams();
  const [p, setP] = useState<Cap>({ tradingBalance: "5000", portfolioValue: "", riskPct: "1", maxLossUsd: "", maxExposurePct: "25", leverage: "1", feePct: "0.2" });
  const [t, setT] = useState<Trade>({ side: sp.get("side") === "SHORT" ? "SHORT" : "LONG", entry: sp.get("entry") ?? "", stop: sp.get("stop") ?? "", tp1: sp.get("tp1") ?? "", tp2: sp.get("tp2") ?? "", tp3: sp.get("tp3") ?? "" });
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [showGuide, setShowGuide] = useState(false);
  const [help, setHelp] = useState<keyof Cap | null>(null);
  const symbol = sp.get("symbol");
  const { currency, rate } = useCurrency();
  const toUsd = (v: number) => (rate ? v / rate : v);

  const [account, setAccount] = useState<"none" | "loading" | "synced">("none");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) { const j = JSON.parse(saved) as Record<string, unknown>; setP((x) => ({ ...x, ...Object.fromEntries(Object.entries(j).filter(([k]) => k in x).map(([k, v]) => [k, v == null || v === 0 || v === "" ? x[k as keyof Cap] : String(v)])) })); }
      const m = localStorage.getItem(MODE_KEY); if (m === "advanced") setMode("advanced");
      if (!localStorage.getItem(KEY)) setShowGuide(true); // first visit: show the walkthrough
    } catch {}
    const lev = Number(sp.get("leverage"));
    if (lev >= 1) setP((x) => ({ ...x, leverage: String(lev) }));
    const sb = supabaseBrowser();
    if (!sb) return;
    setAccount("loading");
    fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.profile) return setAccount("none");
        const pr = j.profile;
        setP((x) => ({ ...x, tradingBalance: pr.trading_balance ? String(pr.trading_balance) : x.tradingBalance, portfolioValue: pr.portfolio_value ? String(pr.portfolio_value) : x.portfolioValue, riskPct: pr.risk_pct ? String(pr.risk_pct) : x.riskPct, maxExposurePct: pr.max_exposure_pct ? String(pr.max_exposure_pct) : x.maxExposurePct, leverage: lev >= 1 ? String(lev) : pr.default_leverage ? String(pr.default_leverage) : x.leverage }));
        setAccount("synced");
      })
      .catch(() => setAccount("none"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (account !== "synced") return;
    const h = setTimeout(() => {
      fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ trading_balance: numOf(p.tradingBalance), portfolio_value: numOf(p.portfolioValue) || null, risk_pct: numOf(p.riskPct), max_exposure_pct: numOf(p.maxExposurePct) || null, default_leverage: numOf(p.leverage) || 1 }) }).catch(() => {});
    }, 800);
    return () => clearTimeout(h);
  }, [p, account]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(p)); localStorage.setItem(MODE_KEY, mode); } catch {} }, [p, mode]);

  const out = useMemo(() => {
    const i: RiskInputs = {
      tradingBalance: toUsd(numOf(p.tradingBalance)), portfolioValue: numOf(p.portfolioValue) ? toUsd(numOf(p.portfolioValue)) : undefined, riskPct: numOf(p.riskPct), maxLossUsd: numOf(p.maxLossUsd) ? toUsd(numOf(p.maxLossUsd)) : undefined,
      maxExposurePct: numOf(p.maxExposurePct) || undefined, leverage: numOf(p.leverage) || 1, feePct: numOf(p.feePct) || 0.2,
      side: t.side, entry: numOf(t.entry), stop: numOf(t.stop), takeProfits: [t.tp1, t.tp2, t.tp3].map(numOf).filter((x) => x > 0),
    };
    return sizePosition(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, t, rate]);
  const money = (usd: number | null | undefined) => (usd == null ? "-" : fmtUsd(usd * rate).replace(/^\$/, currency === "USD" ? "$" : `${currency} `));
  const lev = numOf(p.leverage) || 1;
  const venue = typeof window !== "undefined" ? currentVenue() : "binance";
  const guideHref = `/guide?${new URLSearchParams({ side: t.side, entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3, symbol: symbol ?? "", leverage: String(lev), units: out.ok ? String(out.positionSizeUnits) : "", notional: out.ok ? String(out.positionValueUsd) : "", risk: out.ok ? String(out.riskUsd) : "", balance: String(toUsd(numOf(p.tradingBalance)) || ""), venue })}`;

  const field = (k: keyof Cap, extra?: string) => (
    <label className="relative">
      <span className="flex items-center gap-1">{HELP[k].label}{extra ? ` (${extra})` : ""}<button type="button" className="term-q" aria-label={`What is ${HELP[k].label}?`} onClick={(e) => { e.preventDefault(); setHelp(help === k ? null : k); }}>?</button></span>
      <input inputMode="decimal" className="num" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} placeholder={k === "portfolioValue" || k === "maxLossUsd" ? "optional" : ""} />
    </label>
  );
  const tfield = (k: Exclude<keyof Trade, "side">, label: string, hint: string) => (
    <label>{label}<span className="ml-1 text-[10px] text-fg-3">{hint}</span><input inputMode="decimal" className="num" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>
  );
  const entryN = numOf(t.entry);
  const tp2 = out.profits[1] ?? out.profits[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Position size & risk</h1>
          <p className="text-sm text-fg-2">Answers one question: <b>how much should I buy so that, if the stop hits, I lose only what I planned?</b> {symbol ? <span className="pill pill-mint ml-1">prefilled from {symbol} setup{sp.get("leverage") ? ` at ${sp.get("leverage")}x` : ""}</span> : null}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CurrencyPicker />
          <div className="flex gap-1"><button className="btn-ghost text-xs" data-active={mode === "simple"} onClick={() => setMode("simple")}>Simple</button><button className="btn-ghost text-xs" data-active={mode === "advanced"} onClick={() => setMode("advanced")}>Advanced</button></div>
          <button className="btn-ghost text-xs" onClick={() => setShowGuide((s) => !s)}>{showGuide ? "Hide guide" : "How to use this"}</button>
        </div>
      </div>

      {showGuide ? (
        <Section title="How to use this calculator (2 minutes)">
          <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Enter your trading balance", "Only the money in your trading account. Everything else stays out of the math."],
              ["Pick a risk per trade", "1% is standard. It means: if this trade fails, you lose 1% of the balance, no more. The size is computed from it; you never pick the size yourself."],
              ["Enter the trade", "Entry, stop loss and targets come prefilled from a setup card; you can type your own. The stop must be below the entry for a LONG and above it for a SHORT."],
              ["Read the answer", "'Buy X units'. That is the amount to enter on the exchange. The table shows what you make at each target in money and in R (multiples of your risk)."],
            ].map(([h, b], i) => <li key={i} className="rounded-lg border border-border bg-bg-2 p-3"><div className="mb-1 flex items-center gap-2 font-medium"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-mint-dim text-[11px] text-mint">{i + 1}</span>{h}</div><p className="text-xs text-fg-2">{b}</p></li>)}
          </ol>
          <p className="mt-2 text-xs text-fg-3">Simple mode hides the optional fields (portfolio, caps, fee). Leverage only matters for futures or margin; on spot leave it at 1. Then press <b>How to place it on your exchange</b> for click-by-click steps.</p>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={account === "synced" ? "Your capital (synced to your account)" : "Your capital (saved in this browser)"}>
          <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
            {field("tradingBalance", currency)}
            {field("riskPct")}
            {field("leverage", "1 = spot")}
            {mode === "advanced" ? <>{field("portfolioValue", currency)}{field("maxLossUsd", currency)}{field("maxExposurePct")}{field("feePct")}</> : null}
          </div>
          {help ? <div className="mt-2 rounded-lg border border-mint/40 bg-mint-dim p-2 text-xs text-fg"><b>{HELP[help].label}:</b> {HELP[help].what} <span className="text-fg-2">Example: {HELP[help].example}</span></div> : null}
          {mode === "simple" ? <p className="mt-2 text-[11px] text-fg-3">Using defaults for the optional fields: no exposure cap beyond {p.maxExposurePct || 25}%, fee {p.feePct || 0.2}%. Switch to Advanced to change them.</p> : null}
        </Section>
        <Section title="The trade">
          <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
            <label className="col-span-2">Direction
              <select value={t.side} onChange={(e) => setT({ ...t, side: e.target.value as "LONG" | "SHORT" })}><option value="LONG">LONG (price goes up)</option><option value="SHORT">SHORT (price goes down)</option></select>
            </label>
            {tfield("entry", "Entry", "price you buy/sell at")}
            {tfield("stop", "Stop loss", t.side === "LONG" ? "below entry" : "above entry")}
            {tfield("tp1", "TP1", "first target")}
            {tfield("tp2", "TP2", "second target")}
            {tfield("tp3", "TP3", "third target")}
          </div>
          {entryN > 0 && numOf(t.stop) > 0 ? <p className="num mt-2 text-[11px] text-fg-3">Stop is {Math.abs(((numOf(t.stop) - entryN) / entryN) * 100).toFixed(2)}% from entry. {lev > 1 ? `At ${lev}x the liquidation is about ${(95 / lev).toFixed(1)}% away.` : ""}</p> : null}
        </Section>
        <div className="space-y-3">
          {out.ok ? (
            <div className="rounded-xl border border-mint/50 bg-mint-dim p-4 text-sm">
              <div className="text-[10px] uppercase tracking-wider text-fg-3">What to enter on the exchange</div>
              <div className="mt-1 text-lg font-semibold">{t.side === "LONG" ? "Buy" : "Sell"} <span className="num">{fmtNum(out.positionSizeUnits, 4)}</span> {symbol ?? "units"} <span className="text-fg-2">(about {money(out.positionValueUsd)})</span></div>
              <p className="mt-1 text-xs text-fg-2">If the stop at {fmtUsd(numOf(t.stop))} hits you lose <b className="down">{money(out.riskUsd)}</b>{out.capped && out.capped !== "risk" ? <> (less than your {p.riskPct || 1}% budget of {money((toUsd(numOf(p.tradingBalance)) * numOf(p.riskPct)) / 100)} because the size is capped by {out.capped === "exposure" ? `max exposure ${p.maxExposurePct || 25}%` : "your balance"})</> : <> ({p.riskPct || 1}% of your balance)</>}. {tp2 ? <>At {tp2.label} you make <b className="up">{money(tp2.profitUsd)}</b>, {tp2.rr} times what you risk.</> : null} {lev > 1 ? <>Margin locked: {money(out.marginUsd)} at {lev}x.</> : null}</p>
              <Link href={guideHref} className="btn mt-3 inline-block text-xs">How to place it on {VENUE_META[venue].label} →</Link>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Position size" value={out.ok ? `${fmtNum(out.positionSizeUnits, 4)} units` : "-"} sub={out.ok ? `${money(out.positionValueUsd)} notional` : "enter balance, entry and stop"} />
            <StatCard label="Loss if stop hits" value={<span className="down">{out.ok ? `-${money(out.riskUsd)}` : "-"}</span>} sub={out.ok ? `stop ${out.stopDistancePct}% from entry` : undefined} />
            <StatCard label={lev > 1 ? "Margin locked" : "Capital used"} value={out.ok ? money(out.marginUsd) : "-"} sub={out.ok ? `${out.exposurePctOfTrading}% of trading${out.exposurePctOfPortfolio != null ? ` · ${out.exposurePctOfPortfolio}% of portfolio` : ""}` : undefined} />
            <StatCard label="Left in the account" value={out.ok ? money(out.remainingCapital) : "-"} sub={out.capped && out.capped !== "risk" ? `size capped by ${out.capped}` : "after this trade"} />
          </div>
          <div className="card p-4">
            <div className="mb-2 flex items-baseline justify-between"><span className="text-[11px] uppercase tracking-wider text-fg-3">Profit at each target</span><span className="text-[10px] text-fg-3">R = multiples of the loss at the stop</span></div>
            {out.profits.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Target</th><th>Price</th><th>Move</th><th className="text-right">Profit (fees paid)</th><th className="text-right">R</th></tr></thead>
                  <tbody>
                    {out.profits.map((x) => (
                      <tr key={x.label}>
                        <td className="text-fg-2">{x.label}</td>
                        <td className="num">{fmtUsd(x.price)}</td>
                        <td className="num text-fg-3">{x.pct > 0 ? "+" : ""}{x.pct}%</td>
                        <td className={`num text-right ${x.profitUsd >= 0 ? "up" : "down"}`}>{x.profitUsd >= 0 ? "+" : ""}{money(x.profitUsd)}</td>
                        <td className="num text-right"><b>{x.rr}R</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-fg-3">Enter at least TP1 to see profits.</p>
            )}
            {out.liquidationEstimate ? <p className="num mt-2 text-xs text-fg-3">Estimated liquidation around {fmtUsd(out.liquidationEstimate)} at {lev}x (the exchange&apos;s exact figure is shown in its order form; your stop must be well before it).</p> : null}
          </div>
          {out.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber">{out.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          ) : null}
        </div>
      </div>

      <Section title="What the numbers mean">
        <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(HELP) as (keyof Cap)[]).map((k) => <div key={k} className="rounded-lg border border-border bg-bg-2 p-2"><dt className="font-medium text-fg">{HELP[k].label}</dt><dd className="text-fg-2">{HELP[k].what}</dd><dd className="mt-1 text-fg-3">Example: {HELP[k].example}</dd></div>)}
          <div className="rounded-lg border border-border bg-bg-2 p-2"><dt className="font-medium text-fg">R</dt><dd className="text-fg-2">One R is the money you lose if the stop hits. A target at 2R pays twice that. Over many trades you only need to win about 1 in 3 if your average winner is 2R.</dd></div>
          <div className="rounded-lg border border-border bg-bg-2 p-2"><dt className="font-medium text-fg">Notional vs margin</dt><dd className="text-fg-2">Notional is the full value of the position (units x price). Margin is the part of your money the exchange locks for it: notional divided by leverage. On spot they are the same.</dd></div>
          <div className="rounded-lg border border-border bg-bg-2 p-2"><dt className="font-medium text-fg">Liquidation</dt><dd className="text-fg-2">On futures, the price at which the exchange closes you out because the margin is gone. Roughly 100% / leverage away from entry. The stop must always be hit first.</dd></div>
        </dl>
      </Section>
      <Disclaimer />
    </div>
  );
}
