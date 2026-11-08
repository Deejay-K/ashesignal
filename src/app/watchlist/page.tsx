"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWatchlist, toggleWatch, type WatchItem } from "@/lib/watchlist";
import type { CoinRow } from "@/lib/types";
import CoinTable from "@/components/CoinTable";
import { Disclaimer, Empty, Section } from "@/components/ui";

interface ListRow { id: string; name: string; items: (WatchItem & { rowId: string })[] }

export default function WatchlistPage() {
  const [mode, setMode] = useState<"loading" | "guest" | "account">("loading");
  const [lists, setLists] = useState<ListRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [guest, setGuest] = useState<WatchItem[]>([]);
  const [coins, setCoins] = useState<CoinRow[]>([]);
  const [newName, setNewName] = useState("");

  const loadLists = async () => {
    const r = await fetch("/api/me/watchlists");
    if (!r.ok) {
      setMode("guest");
      setGuest(getWatchlist());
      return;
    }
    const j = (await r.json()) as { lists: ListRow[] };
    setLists(j.lists);
    setActive((a) => a && j.lists.some((l) => l.id === a) ? a : j.lists[0]?.id ?? null);
    setMode("account");
  };
  useEffect(() => {
    loadLists();
    const onChange = () => (mode === "guest" ? setGuest(getWatchlist()) : loadLists());
    window.addEventListener("watchlist-change", onChange);
    return () => window.removeEventListener("watchlist-change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items: WatchItem[] = mode === "guest" ? guest : (lists.find((l) => l.id === active)?.items ?? []);
  const [cats, setCats] = useState<Record<string, { cat: string; tf: string; side: string | null }[]>>({});
  useEffect(() => {
    const ids = items.filter((i) => !i.address).map((i) => i.id);
    if (!ids.length) return setCoins([]);
    const load = () => {
      fetch(`/api/market/coins?ids=${ids.join(",")}`).then((r) => r.json()).then((d) => setCoins(d.coins ?? [])).catch(() => {});
      fetch(`/api/opportunities?cat=all`).then((r) => r.json()).then((d) => { const m: Record<string, { cat: string; tf: string; side: string | null }[]> = {}; for (const o of d.items ?? []) { if (!ids.includes(String(o.assetKey).replace(/^cg:/, ""))) continue; const k = String(o.assetKey).replace(/^cg:/, ""); (m[k] ??= []).push({ cat: o.category, tf: o.timeframe, side: o.side }); } setCats(m); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active, lists, guest]);

  const act = async (body: Record<string, unknown>) => {
    await fetch("/api/me/watchlists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    loadLists();
  };
  const dexItems = items.filter((i) => i.address);
  const current = lists.find((l) => l.id === active);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Watchlists</h1>
        <p className="text-sm text-fg-2">
          {mode === "guest" ? <><span className="pill pill-amber mr-1">guest mode</span> One list, saved in this browser only. <Link href="/login" className="link">Sign in</Link> for multiple synced lists.</> : "Synced to your account. Starring from anywhere adds to your first list; move items between lists here."}
        </p>
      </div>

      {mode === "account" ? (
        <div className="flex flex-wrap items-center gap-2">
          {lists.map((l) => (
            <button key={l.id} className="btn-ghost" data-active={l.id === active} onClick={() => setActive(l.id)}>{l.name} <span className="text-fg-3">{l.items.length}</span></button>
          ))}
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { act({ action: "create", name: newName.trim() }); setNewName(""); } }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New list…" className="!w-36 !py-1.5 text-sm" />
            <button className="btn !py-1.5 text-sm">+</button>
          </form>
          {current ? (
            <span className="ml-auto flex gap-1">
              <button className="btn-ghost" onClick={() => { const n = prompt("Rename list", current.name); if (n?.trim()) act({ action: "rename", id: current.id, name: n.trim() }); }}>rename</button>
              {lists.length > 1 ? <button className="btn-ghost" onClick={() => confirm(`Delete "${current.name}" and its ${current.items.length} items?`) && act({ action: "delete", id: current.id })}>delete</button> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {Object.keys(cats).length ? (
        <Section title="Discovery status of your coins" right={<Link href="/opportunities" className="link text-xs">Trading Discovery</Link>}>
          <ul className="flex flex-wrap gap-2 text-xs">
            {Object.entries(cats).map(([id, list]) => (
              <li key={id} className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-bg-2 px-2 py-1">
                <Link href={`/token/${id}`} className="font-medium hover:text-mint">{coins.find((c) => c.id === id)?.symbol ?? id}</Link>
                {list.map((x, i) => <span key={i} className={`pill ${x.cat === "confirmed" ? "pill-mint" : x.cat === "speculative" ? "pill-amber" : "pill-gray"}`}>{x.cat}{x.side ? ` ${x.side}` : ""} {x.tf}</span>)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-fg-3">Coins on your list that the engine currently grades as Confirmed, Watching or a Spot pick. Coins not shown have no active category right now.</p>
        </Section>
      ) : null}
      <Section title="Coins">
        {coins.length ? <CoinTable coins={coins} /> : items.filter((i) => !i.address).length ? <p className="text-sm text-fg-3">Loading…</p> : <Empty>Star any coin (☆) on the dashboard or a token page to add it.</Empty>}
        {mode === "account" && lists.length > 1 && items.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
            Move to:
            {items.map((i) => (
              <span key={i.id} className="flex items-center gap-1">
                <b className="text-fg">{i.symbol}</b>
                <select className="!w-auto !py-0.5 text-xs" value={active ?? ""} onChange={(e) => act({ action: "move", rowId: (i as WatchItem & { rowId: string }).rowId, toListId: e.target.value })}>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </span>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="DEX tokens (by address)">
        {dexItems.length ? (
          <ul className="divide-y divide-border text-sm">
            {dexItems.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/scanner?address=${i.address}`} className="font-medium hover:text-mint">{i.symbol}</Link>
                <span className="text-fg-3">{i.name}</span>
                <span className="pill pill-gray">{i.chain}</span>
                <span className="num ml-auto truncate text-xs text-fg-3">{i.address}</span>
                <button className="btn-ghost" onClick={() => toggleWatch(i)}>remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Star a scanned token to track it here.</Empty>
        )}
      </Section>
      <Disclaimer />
    </div>
  );
}
