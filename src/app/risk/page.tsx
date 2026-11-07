"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sizePosition, type RiskInputs } from "@/lib/risk/position";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Disclaimer, Section, StatCard } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

const KEY = "ashesignal.risk.profile.v1";

export default function RiskPage() {
  return (
    <Suspense>
      <Risk />
    </Suspense>
  );
}

function Risk() {
  const sp = useSearchParams();
  const [p, setP] = useState({ tradingBalance: 5000, portfolioValue: 10000, riskPct: 1, maxLossUsd: 0, maxExposurePct: 25, leverage: 1, feePct: 0.2 });
  const [t, setT] = useState({
    side: (sp.get("side") as "LONG" | "SHORT") ?? "LONG",
    entry: Number(sp.get("entry") ?? 0),
    stop: Number(sp.get("stop") ?? 0),
    tp1: Number(sp.get("tp1") ?? 0),
    tp2: Number(sp.get("tp2") ?? 0),
    tp3: Number(sp.get("tp3") ?? 0),
  });
  const symbol = sp.get("symbol");

  const [account, setAccount] = useState<"none" | "loading" | "synced">("none");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setP((x) => ({ ...x, ...JSON.parse(saved) }));
    } catch {}
    const sb = supabaseBrowser();
    if (!sb) return;
    setAccount("loading");
    fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.profile) return setAccount("none");
        const pr = j.profile;
        setP((x) => ({ ...x, tradingBalance: pr.trading_balance ?? x.tradingBalance, portfolioValue: pr.portfolio_value ?? x.portfolioValue, riskPct: pr.risk_pct ?? x.riskPct, maxExposurePct: pr.max_exposure_pct ?? x.maxExposurePct, leverage: pr.default_leverage ?? x.leverage }));
        setAccount("synced");
      })
      .catch(() => setAccount("none"));
  }, []);
  useEffect(() => {
    if (account !== "synced") return;
    const t = setTimeout(() => {
      fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ trading_balance: p.tradingBalance, portfolio_value: p.portfolioValue, risk_pct: p.riskPct, max_exposure_pct: p.maxExposurePct, default_leverage: p.leverage }) }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [p, account]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
  }, [p]);

  const out = useMemo(() => {
    const i: RiskInputs = { ...p, maxLossUsd: p.maxLossUsd || undefined, side: t.side, entry: t.entry, stop: t.stop, takeProfits: [t.tp1, t.tp2, t.tp3].filter((x) => x > 0) };
    return sizePosition(i);
  }, [p, t]);

  const num = (k: keyof typeof p) => ({ type: "number", step: "any", value: p[k] || "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) }) }) as const;
  const tn = (k: keyof typeof t) => ({ type: "number", step: "any", value: (t[k] as number) || "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: Number(e.target.value) }) }) as const;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Position sizing & risk calculator</h1>
        <p className="text-sm text-fg-2">Size is derived from your risk budget ÷ stop distance. The calculator will never size above your limits. {symbol ? <span className="pill pill-mint ml-1">prefilled from {symbol} setup</span> : null}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={account === "synced" ? "Your capital (synced to your account)" : "Your capital (saved in this browser)"}>
          <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
            <label>Trading balance $<input {...num("tradingBalance")} /></label>
            <label>Total portfolio $<input {...num("portfolioValue")} /></label>
            <label>Risk per trade %<input {...num("riskPct")} /></label>
            <label>Max loss per trade $ (optional)<input {...num("maxLossUsd")} /></label>
            <label>Max exposure % of trading<input {...num("maxExposurePct")} /></label>
            <label>Leverage ×<input {...num("leverage")} /></label>
            <label>Round-trip fee %<input {...num("feePct")} /></label>
          </div>
        </Section>
        <Section title="Trade">
          <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
            <label className="col-span-2">Side
              <select value={t.side} onChange={(e) => setT({ ...t, side: e.target.value as "LONG" | "SHORT" })}><option>LONG</option><option>SHORT</option></select>
            </label>
            <label>Entry<input {...tn("entry")} className="num" /></label>
            <label>Stop loss<input {...tn("stop")} className="num" /></label>
            <label>TP1<input {...tn("tp1")} className="num" /></label>
            <label>TP2<input {...tn("tp2")} className="num" /></label>
            <label>TP3<input {...tn("tp3")} className="num" /></label>
          </div>
        </Section>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Position size" value={out.ok ? `${fmtNum(out.positionSizeUnits, 4)} units` : "—"} sub={out.ok ? `${fmtUsd(out.positionValueUsd)} notional` : undefined} />
            <StatCard label="Max loss (SL hit)" value={<span className="down">{out.ok ? `−${fmtUsd(out.riskUsd)}` : "—"}</span>} sub={out.ok ? `stop ${out.stopDistancePct}% from entry` : undefined} />
            <StatCard label="Margin used" value={out.ok ? fmtUsd(out.marginUsd) : "—"} sub={out.ok ? `${out.exposurePctOfTrading}% of trading${out.exposurePctOfPortfolio != null ? ` · ${out.exposurePctOfPortfolio}% of portfolio` : ""}` : undefined} />
            <StatCard label="Remaining capital" value={out.ok ? fmtUsd(out.remainingCapital) : "—"} sub={out.capped ? `capped by ${out.capped}` : undefined} />
          </div>
          <div className="card p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-fg-3">Profit at targets</div>
            {out.profits.length ? (
              <table>
                <tbody>
                  {out.profits.map((x) => (
                    <tr key={x.label}>
                      <td className="text-fg-2">{x.label}</td>
                      <td className="num">{fmtUsd(x.price)}</td>
                      <td className="num text-fg-3">{x.pct > 0 ? "+" : ""}{x.pct}%</td>
                      <td className="num up text-right">+{fmtUsd(x.profitUsd)}</td>
                      <td className="num text-right"><b>{x.rr}R</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-fg-3">Enter at least TP1.</p>
            )}
            {out.liquidationEstimate ? <p className="num mt-2 text-xs text-fg-3">Est. liquidation ≈ {fmtUsd(out.liquidationEstimate)}</p> : null}
          </div>
          {out.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber">{out.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          ) : null}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
