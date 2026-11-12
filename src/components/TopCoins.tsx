"use client";

import { useEffect, useState } from "react";
import type { CoinRow } from "@/lib/types";
import { assetKind } from "@/lib/market/junk";
import CoinTable from "./CoinTable";

const KEY = "as_top_real";

/** Top coins by market cap, with stablecoins, wrapped copies and tokenized stocks or funds hidden by default. */
export default function TopCoins({ coins, show = 50 }: { coins: CoinRow[]; show?: number }) {
  const [real, setReal] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === "0") setReal(false); } catch { /* private mode */ } }, []);
  const toggle = () => { const v = !real; setReal(v); try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ } };
  const hidden = coins.slice(0, show).filter((c) => assetKind(c) !== "coin").length;
  const list = (real ? coins.filter((c) => assetKind(c) === "coin") : coins).slice(0, show);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={toggle} aria-pressed={real} className={`btn-ghost !py-1 !text-[11px] ${real ? "!border-mint !text-mint" : ""}`}>{real ? "✓ Real coins only" : "Showing everything"}</button>
        <span className="text-fg-3">{real ? `Hiding stablecoins, wrapped coins and tokenized stocks or funds${hidden ? ` (${hidden} in the top ${show})` : ""}.` : "Includes stablecoins, wrapped coins and tokenized stocks or funds."}</span>
      </div>
      <CoinTable coins={list} />
    </div>
  );
}
