"use client";

import { useEffect, useState } from "react";
import type { RealizedLot } from "@/lib/exchanges";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import type { ExchangeFill, ExchangeBalance, ExchangeId } from "@/lib/exchanges/types";
import { fmtNum, fmtUsd, pctClass, timeAgo } from "@/lib/format";
import { Empty, Section, StatCard } from "./ui";

interface Acc { id: string; exchange: ExchangeId; label: string | null; permissions: string[] | null; lastOkAt: string | null; error: string | null; balances: ExchangeBalance[]; fills?: ExchangeFill[] }
interface Res { enabled: boolean; note?: string; accounts: Acc[]; realized: { perAsset: RealizedLot[]; totalRealizedUsd: number; totalFeesUsd: number; tradeCount: number; unpricedQuotes: string[] } | null }

const HELP: Record<ExchangeId, string> = {
  kraken: "Kraken: Settings > API > Add key. Tick ONLY 'Query Funds' and 'Query Closed Orders & Trades'. Paste the API Key and Private Key.",
  coinbase: "Coinbase: portal.cdp.coinbase.com > API keys > Create API key > permission 'View' only. Easiest: open the JSON file Coinbase downloaded, copy ALL of its text and paste it into the box below. It works with either ECDSA or Ed25519 keys.",
  binance: "Binance: API Management > Create > 'Enable Reading' only, no trading or withdrawals. Not available to Canadian residents.",
};

export default function ExchangePanel({ onChange }: { onChange?: () => void }) {
  const [r, setR] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ exchange: "kraken" as ExchangeId, key: "", secret: "", passphrase: "", label: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/me/exchanges").catch(() => null);
    if (res?.ok) setR(await res.json());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/me/exchanges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "err", text: j.error });
    setMsg({ tone: "ok", text: j.warning ? `Connected. ${j.warning}` : "Connected (read-only verified)." });
    setForm({ ...form, key: "", secret: "", passphrase: "", label: "" });
    await load();
    onChange?.();
  };

  const rz = r?.realized;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Exchange accounts (read-only)">
          {r && !r.enabled ? <Empty>{r.note}</Empty> : (
            <>
              <form className="space-y-2 text-xs text-fg-3" onSubmit={add}>
                <label>Exchange<select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value as ExchangeId })}>{(Object.keys(EXCHANGE_LABELS) as ExchangeId[]).map((x) => <option key={x} value={x}>{EXCHANGE_LABELS[x]}</option>)}</select></label>
                <p className="text-[11px] leading-snug">{HELP[form.exchange]}</p>
                {form.exchange === "coinbase" ? (
                  <>
                    <label>Paste the downloaded key file (JSON) here<textarea required rows={4} className="w-full rounded-lg border border-border bg-bg-3 p-2 font-mono text-xs text-fg" placeholder={'{ "name": "organizations/.../apiKeys/...", "privateKey": "..." }'} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></label>
                    <details className="text-[11px]"><summary className="cursor-pointer">No file? Enter the two values manually</summary>
                      <label className="mt-1 block">API key ID (or full organizations/.../apiKeys/... name)<input className="num" value={form.secret ? form.key : form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></label>
                      <label className="mt-1 block">Secret (PEM block or Ed25519 base64)<textarea rows={3} className="w-full rounded-lg border border-border bg-bg-3 p-2 font-mono text-xs text-fg" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></label>
                    </details>
                  </>
                ) : (
                  <>
                    <label>API key<input className="num" required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} autoComplete="off" /></label>
                    <label>Secret<input className="num" type="password" required value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="off" /></label>
                  </>
                )}
                <label>Label (optional)<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
                <button className="btn w-full text-sm" disabled={busy}>{busy ? "Checking key" : "Connect"}</button>
                {msg ? <p className={msg.tone === "ok" ? "text-mint" : "text-red"}>{msg.text}</p> : null}
                <p className="text-[11px]">Keys are encrypted before storage and are only ever used to read balances and trade history. Keys with trade or withdrawal rights are refused where the exchange reports them.</p>
              </form>
              <ul className="mt-3 divide-y divide-border text-sm">
                {r?.accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="pill pill-gray">{EXCHANGE_LABELS[a.exchange]}</span>
                    <span>{a.label ?? ""}</span>
                    {a.error ? <span className="pill pill-red" title={a.error}>error</span> : <span className="pill pill-mint">ok {a.lastOkAt ? timeAgo(new Date(a.lastOkAt).getTime()) : ""}</span>}
                    <span className="num text-xs text-fg-3">{a.balances.length} assets</span>
                    <button className="btn-ghost ml-auto" onClick={async () => { await fetch(`/api/me/exchanges?id=${a.id}`, { method: "DELETE" }); await load(); onChange?.(); }}>remove</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Realized P&L" value={<span className={pctClass(rz?.totalRealizedUsd)}>{rz ? fmtUsd(rz.totalRealizedUsd) : "-"}</span>} sub="FIFO, fees included" />
            <StatCard label="Fees paid" value={rz ? fmtUsd(rz.totalFeesUsd) : "-"} />
            <StatCard label="Trades" value={rz ? rz.tradeCount : "-"} sub="across connected exchanges" />
            <StatCard label="Assets traded" value={rz ? rz.perAsset.length : "-"} />
          </div>
          <Section title="Realized P&L by asset">
            {loading ? <div className="h-24 animate-pulse rounded-lg bg-bg-3" /> : rz?.perAsset.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Asset</th><th className="text-right">Realized</th><th className="text-right">Fees</th><th className="text-right">Buys / sells</th><th className="text-right">Still held</th><th className="text-right">Avg cost (FIFO)</th><th>Period</th></tr></thead>
                  <tbody>
                    {rz.perAsset.map((a) => (
                      <tr key={a.asset}>
                        <td className="font-medium">{a.asset}</td>
                        <td className={`num text-right ${pctClass(a.realizedUsd)}`}>{fmtUsd(a.realizedUsd)}</td>
                        <td className="num text-right text-fg-2">{fmtUsd(a.feesUsd)}</td>
                        <td className="num text-right text-fg-2">{a.buys} / {a.sells}</td>
                        <td className="num text-right">{fmtNum(a.remaining, 4)}</td>
                        <td className="num text-right">{a.avgCost != null ? fmtUsd(a.avgCost) : "-"}</td>
                        <td className="text-xs text-fg-3">{a.firstTrade ? new Date(a.firstTrade).toLocaleDateString() : ""} to {a.lastTrade ? new Date(a.lastTrade).toLocaleDateString() : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rz.unpricedQuotes.length ? <p className="mt-2 text-xs text-amber">Trades quoted in {rz.unpricedQuotes.join(", ")} were skipped (non-USD quote). Crypto-to-crypto pairs need historical pricing; planned.</p> : null}
                <p className="mt-2 text-xs text-fg-3">Sells beyond known buys (coins deposited from elsewhere) are counted at zero cost, which overstates realized profit for those amounts.</p>
              </div>
            ) : <Empty>{r?.accounts.length ? "No trades found on the connected accounts." : "Connect an exchange to see realized P&L."}</Empty>}
          </Section>
        </div>
      </div>
    </div>
  );
}
