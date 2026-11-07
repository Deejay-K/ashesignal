"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWatchlist, toggleWatch, type WatchItem } from "@/lib/watchlist";
import type { CoinRow } from "@/lib/types";
import CoinTable from "@/components/CoinTable";
import { Disclaimer, Empty, Section } from "@/components/ui";

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [coins, setCoins] = useState<CoinRow[]>([]);
  useEffect(() => {
    const load = () => setItems(getWatchlist());
    load();
    window.addEventListener("watchlist-change", load);
    return () => window.removeEventListener("watchlist-change", load);
  }, []);
  useEffect(() => {
    const ids = items.filter((i) => !i.address).map((i) => i.id);
    if (!ids.length) return setCoins([]);
    fetch(`/api/market/coins?ids=${ids.join(",")}`).then((r) => r.json()).then((d) => setCoins(d.coins ?? [])).catch(() => {});
    const t = setInterval(() => fetch(`/api/market/coins?ids=${ids.join(",")}`).then((r) => r.json()).then((d) => setCoins(d.coins ?? [])).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [items]);
  const dexItems = items.filter((i) => i.address);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Watchlist</h1>
        <p className="text-sm text-fg-2">
          <span className="pill pill-amber mr-1">guest mode</span> Saved in this browser only. Sign-in with cloud sync (Supabase) is Stage 2 — see the README.
        </p>
      </div>
      <Section title="Coins">
        {coins.length ? <CoinTable coins={coins} /> : items.filter((i) => !i.address).length ? <p className="text-sm text-fg-3">Loading…</p> : <Empty>Star any coin (☆) on the dashboard or a token page to add it.</Empty>}
      </Section>
      <Section title="DEX tokens (by address)">
        {dexItems.length ? (
          <ul className="divide-y divide-border text-sm">
            {dexItems.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2">
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
