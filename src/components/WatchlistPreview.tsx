"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWatchlist, type WatchItem } from "@/lib/watchlist";
import type { CoinRow } from "@/lib/types";
import CoinTable from "./CoinTable";
import { Section } from "./ui";

export default function WatchlistPreview() {
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
    if (!ids.length) {
      setCoins([]);
      return;
    }
    fetch(`/api/market/coins?ids=${ids.join(",")}`).then((r) => r.json()).then((d) => setCoins(d.coins ?? [])).catch(() => {});
  }, [items]);
  if (!items.length) return null;
  return (
    <Section title="Your watchlist" right={<span className="text-xs text-fg-3">guest mode · saved in this browser · <Link href="/watchlist" className="link">manage</Link></span>}>
      {coins.length ? <CoinTable coins={coins} compact /> : <p className="text-sm text-fg-3">Loading…</p>}
    </Section>
  );
}
