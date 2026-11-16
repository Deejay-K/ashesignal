"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sharedJson } from "@/lib/shared-fetch";

interface Item { name: string; symbol: string; side: "LONG" | "SHORT"; tf: string; pct: number; r: number | null; win: boolean; at: string }

/**
 * A thin strip under the header that scrolls members' latest closed trades, wins and losses alike: nickname, coin,
 * direction and percent. It moves on its own, pauses under the mouse or a finger, and stands still (scrollable by
 * hand) for people who turned motion off. Hidden when there is nothing to show.
 */
export default function ResultsTicker() {
  const path = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => sharedJson<{ items?: Item[] }>("/api/ticker", 60_000).then((j) => { if (alive && j?.items) setItems(j.items); });
    load(); const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!items.length || path.startsWith("/login")) return null;
  const wins = items.filter((i) => i.win).length;
  const row = (dup: boolean) => items.map((i, k) => (
    <span key={`${dup ? "b" : "a"}${k}`} className="rt-item" aria-hidden={dup || undefined}>
      <span className="rt-name">{i.name}</span>
      <span className="rt-sym">{i.symbol}</span>
      <span className={i.side === "LONG" ? "rt-long" : "rt-short"}>{i.side === "LONG" ? "long" : "short"} {i.tf}</span>
      <span className={`rt-pct ${i.win ? "up" : "down"}`}>{i.win ? "▲" : "▼"} {i.pct >= 0 ? "+" : ""}{i.pct.toFixed(1)}%</span>
    </span>
  ));
  // Speed follows the amount of text so a long list does not race past.
  const seconds = Math.max(30, items.length * 5);
  return (
    <div className="results-ticker" role="region" aria-label="Members' latest closed trades, wins and losses">
      <Link href="/card" className="rt-label" title="Results members logged in their own journal, losses included. Tap to make your own card.">
        <span className="rt-live" aria-hidden="true" />Member results<span className="rt-count">{wins}W {items.length - wins}L</span>
      </Link>
      <div className="rt-window">
        <div className="rt-track" style={{ animationDuration: `${seconds}s` }}>{row(false)}{row(true)}</div>
      </div>
    </div>
  );
}
