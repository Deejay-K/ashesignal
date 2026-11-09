"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Portfolio } from "@/lib/portfolio";
import { fmtNum, fmtPct, fmtUsd, pctClass, timeAgo } from "@/lib/format";
import { Disclaimer, Empty, Section, StatCard } from "@/components/ui";
import HistoryChart from "@/components/HistoryChart";
import ExchangePanel from "@/components/ExchangePanel";
import Term from "@/components/Term";
import CurrencyPicker from "@/components/CurrencyPicker";
import { useCurrency } from "@/lib/currency";
import { downloadCsv } from "@/lib/csv";

interface Wallet { id: string; chain: string; address: string; label: string | null }
const COLORS = ["#36bd94", "#5aa7ff", "#f2b544", "#f0506e", "#a78bfa", "#9fb0c0", "#7fd4b0", "#ff8c5a"];

export default function PortfolioPage() {
  const [state, setState] = useState<"loading" | "guest" | "disabled" | "ok">("loading");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [showDust, setShowDust] = useState(false);
  const [chains, setChains] = useState<string[]>([]);
  const [p, setP] = useState<Portfolio | null>(null);
  const [history, setHistory] = useState<{ date: string; totalUsd: number }[]>([]);
  const [form, setForm] = useState({ chain: "ethereum", address: "", label: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cbEdit, setCbEdit] = useState<{ key: string; value: string } | null>(null);
  const { fmt: fmtMoney, currency } = useCurrency();

  const loadWallets = async () => {
    const r = await fetch("/api/me/wallets");
    if (r.status === 501) return setState("disabled");
    if (r.status === 401) return setState("guest");
    const j = await r.json();
    setWallets(j.wallets);
    setChains(j.chains);
    setState("ok");
    return j.wallets as Wallet[];
  };
  const loadPortfolio = async (snapshot = false) => {
    setBusy(true);
    const r = await fetch(`/api/me/portfolio${snapshot ? "?snapshot=1" : ""}`);
    if (r.ok) {
      const j = await r.json();
      setP(j.portfolio);
      setHistory(j.history);
    }
    setBusy(false);
  };
  useEffect(() => {
    loadWallets().then((w) => {
      if (w) loadPortfolio(true);
    });
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api/me/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    if (!r.ok) return setErr((await r.json()).error);
    setForm({ ...form, address: "", label: "" });
    await loadWallets();
    loadPortfolio(true);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Portfolio</h1>
          <Link href="/radar" className="link text-xs">Holdings radar: what the engine says about each coin you hold</Link>
        <div className="mt-1"><CurrencyPicker /></div>
        <p className="text-sm text-fg-2">Read-only wallet tracking (public addresses) plus read-only exchange accounts for balances, trade history and realized P&amp;L. AsheSignal never asks for seed phrases or keys that can trade or withdraw.</p>
      </div>
      {state === "disabled" ? <Empty>Accounts are not configured (docs/SETUP.md step 3).</Empty> : null}
      {state === "guest" ? <Empty><Link href="/login" className="link">Sign in</Link> to track wallets.</Empty> : null}
      {state === "ok" ? (
        <>
          {p ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total value" value={fmtMoney(p.totalUsd, { compact: p.totalUsd > 1e6 })} sub={`${p.holdings.filter((h) => !h.dust).length} holdings · ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}${p.dustCount ? ` · ${p.dustCount} dust hidden` : ""}`} />
              <StatCard label="24h change" value={<span className={pctClass(change24(p))}>{fmtPct(change24(p))}</span>} sub="value-weighted, priced holdings" />
              <StatCard label={<Term id="unrealized">Unrealized P&L</Term>} value={<span className={pctClass(unreal(p))}>{unreal(p) != null ? fmtMoney(unreal(p)) : "-"}</span>} sub="on holdings with a cost basis" />
              <StatCard label="Priced" value={`${p.pricedPct.toFixed(0)}%`} sub={p.pricedPct < 100 ? "some tokens have no market price" : "all holdings priced"} />
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Wallets">
              <form className="space-y-2 text-xs text-fg-3" onSubmit={add}>
                <label>Chain<select value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}>{chains.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label>Public address<input className="num" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x… or Solana address" /></label>
                <label>Label (optional)<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Main, Ledger, Phantom…" /></label>
                <button className="btn w-full text-sm">Add wallet</button>
                {err ? <p className="text-red">{err}</p> : null}
              </form>
              <ul className="mt-3 divide-y divide-border text-sm">
                {wallets.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 py-2">
                    <span className="pill pill-gray">{w.chain}</span>
                    <span className="truncate">{w.label ?? `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}</span>
                    <button className="btn-ghost ml-auto" onClick={async () => { await fetch(`/api/me/wallets?id=${w.id}`, { method: "DELETE" }); await loadWallets(); loadPortfolio(); }}>✕</button>
                  </li>
                ))}
              </ul>
              {p && !p.providers.alchemy ? <p className="mt-2 text-xs text-amber">EVM wallets need ALCHEMY_API_KEY (free) - SETUP.md step 8.</p> : null}
              {p && !p.providers.helius ? <p className="mt-2 text-xs text-amber">Solana wallets need HELIUS_API_KEY (free) - SETUP.md step 8.</p> : null}
            </Section>
            <Section title="Allocation" className="lg:col-span-2" right={p ? <button className="btn-ghost" onClick={() => loadPortfolio()} disabled={busy}>{busy ? "Refreshing…" : `Refresh · ${timeAgo(p.generatedAt)}`}</button> : null}>
              {p && p.totalUsd > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Donut title="By asset" items={p.byAsset.slice(0, 8).map((a) => ({ label: a.symbol, pct: a.pct, value: a.valueUsd }))} />
                  <Donut title="By network" items={p.byChain.map((a) => ({ label: a.chain, pct: a.pct, value: a.valueUsd }))} />
                </div>
              ) : <Empty>{wallets.length ? (busy ? "Loading holdings…" : "No priced holdings yet.") : "Add a wallet to see your allocation."}</Empty>}
            </Section>
          </div>

          {p?.errors.length ? <p className="text-xs text-amber">{p.errors.join(" · ")}</p> : null}

          <ExchangePanel onChange={() => loadPortfolio(true)} />

          {history.length > 1 ? (
            <Section title="Portfolio value history" right={<span className="text-xs text-fg-3">one snapshot per day (worker) + whenever you open this page</span>}>
              <HistoryChart points={history} />
            </Section>
          ) : null}

          <Section title="Holdings" right={p?.holdings.length ? <span className="flex items-center gap-2">{p.dustCount ? <label className="flex items-center gap-1 text-xs text-fg-3"><input type="checkbox" className="w-auto" checked={showDust} onChange={(e) => setShowDust(e.target.checked)} /> show {p.dustCount} dust</label> : null}<button className="btn-ghost" onClick={() => downloadCsv("ashesignal-holdings.csv", p.holdings.filter((h) => showDust || !h.dust).map((h) => ({ symbol: h.symbol, name: h.name, chain: h.chain, wallet: h.walletLabel ?? h.wallet, address: h.address ?? "", amount: h.amount, price_usd: h.priceUsd, value_usd: h.valueUsd, change_24h_pct: h.change24hPct, cost_basis_usd: h.costBasis, unrealized_usd: h.unrealizedUsd, price_source: h.priceSource })))}>Export CSV</button></span> : null}>
            {p?.holdings.length ? (
              <div className="overflow-x-auto">
                <table>
                  <thead><tr><th>Asset</th><th>Chain</th><th className="text-right">Amount</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right">Value</th><th className="text-right">Cost basis ({currency})</th><th className="text-right">Unrealized</th><th /></tr></thead>
                  <tbody>
                    {p.holdings.filter((h) => showDust || !h.dust).map((h) => {
                      const key = `${h.chain}:${h.address ?? "native"}`;
                      return (
                        <tr key={key + h.wallet}>
                          <td><span className="flex items-center gap-2">{h.logo ? <img src={h.logo} alt="" className="h-5 w-5 rounded-full" /> : null}<b>{h.symbol}</b><span className="text-fg-3">{h.name.slice(0, 18)}</span></span></td>
                          <td><span className="pill pill-gray">{h.chain}</span></td>
                          <td className="num text-right">{fmtNum(h.amount, 4)}</td>
                          <td className="num text-right">{fmtMoney(h.priceUsd)} {h.priceSource !== "unavailable" ? <span className="text-[10px] text-fg-3">{h.priceSource}</span> : null}</td>
                          <td className={`num text-right ${pctClass(h.change24hPct)}`}>{fmtPct(h.change24hPct, 1)}</td>
                          <td className="num text-right">{fmtMoney(h.valueUsd)}</td>
                          <td className="num text-right">
                            {cbEdit?.key === key ? (
                              <input autoFocus className="w-24 !py-1 text-right" value={cbEdit.value} onChange={(e) => setCbEdit({ key, value: e.target.value })} onBlur={async () => { await fetch("/api/me/portfolio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: h.chain, address: h.address, costPerUnit: Number(cbEdit.value) }) }); setCbEdit(null); loadPortfolio(); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                            ) : (
                              <button className="text-fg-2 hover:text-mint" onClick={() => setCbEdit({ key, value: String(h.costBasis ?? "") })}>{h.costBasis != null ? fmtMoney(h.costBasis) : "set"}</button>
                            )}
                          </td>
                          <td className={`num text-right ${pctClass(h.unrealizedUsd)}`}>{h.unrealizedUsd != null ? `${fmtMoney(h.unrealizedUsd)} (${fmtPct(h.unrealizedPct, 1)})` : "-"}</td>
                          <td>{h.address && !h.address.startsWith("cex:") ? <Link href={`/scanner?address=${h.address}`} className="link text-xs">scan</Link> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{wallets.length ? "No holdings found." : "Add a wallet first."}</Empty>}
            <p className="mt-2 text-xs text-fg-3">Unrealized P&amp;L uses the FIFO average cost from your exchange trade history where available, otherwise a cost basis you enter per asset (tap "set"). Manual entries override the automatic value.</p>
          </Section>

          <Section title="Recent transactions" right={p?.transactions.length ? <button className="btn-ghost" onClick={() => downloadCsv("ashesignal-transactions.csv", p.transactions.map((t) => ({ time: t.timestamp, chain: t.chain, direction: t.direction, asset: "asset" in t ? t.asset : "", value: t.value, type: "type" in t ? t.type : "", hash: t.hash })))}>Export CSV</button> : null}>
            {p?.transactions.length ? (
              <div className="max-h-96 overflow-auto">
                <table>
                  <thead><tr><th>When</th><th>Chain</th><th>Dir</th><th>Asset</th><th className="text-right">Amount</th><th>Tx</th></tr></thead>
                  <tbody>
                    {p.transactions.map((t, i) => (
                      <tr key={t.hash + i}>
                        <td className="text-fg-3">{t.timestamp ? timeAgo(new Date(t.timestamp).getTime()) : "-"}</td>
                        <td><span className="pill pill-gray">{t.chain}</span></td>
                        <td className={t.direction === "in" ? "up" : t.direction === "out" ? "down" : "text-fg-3"}>{t.direction}</td>
                        <td>{"description" in t && t.description ? <span title={t.description}>{t.type}</span> : t.asset}</td>
                        <td className="num text-right">{t.value != null ? fmtNum(t.value, 4) : "-"} {"asset" in t ? t.asset : ""}</td>
                        <td className="num text-xs text-fg-3">{t.hash.slice(0, 10)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No transactions loaded.</Empty>}
          </Section>
        </>
      ) : null}
      <Disclaimer />
    </div>
  );
}

function change24(p: Portfolio): number | null {
  const priced = p.holdings.filter((h) => h.valueUsd != null && h.change24hPct != null);
  const tot = priced.reduce((s, h) => s + h.valueUsd!, 0);
  if (!tot) return null;
  return priced.reduce((s, h) => s + (h.change24hPct! * h.valueUsd!) / tot, 0);
}
function unreal(p: Portfolio): number | null {
  const xs = p.holdings.filter((h) => h.unrealizedUsd != null);
  return xs.length ? xs.reduce((s, h) => s + h.unrealizedUsd!, 0) : null;
}

function Donut({ title, items }: { title: string; items: { label: string; pct: number; value: number }[] }) {
  let acc = 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90">
        {items.map((it, i) => {
          const len = (it.pct / 100) * c;
          const el = <circle key={it.label} cx="50" cy="50" r={r} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        })}
      </svg>
      <div className="min-w-0 text-xs">
        <div className="mb-1 uppercase tracking-wider text-fg-3">{title}</div>
        <ul className="space-y-0.5">
          {items.map((it, i) => (
            <li key={it.label} className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /><span className="truncate">{it.label}</span><span className="num ml-auto text-fg-2">{it.pct.toFixed(1)}%</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
