"use client";

import { useState } from "react";
import { fmtUsd, fmtNum } from "@/lib/format";
import { VENUE_META, type VenueId } from "@/lib/venues";

/**
 * The exact orders to type into the exchange for one setup, with the user's units filled in. This is the
 * "follow it line by line" view; the steps below explain the clicks. Nothing is sent anywhere.
 */
export default function OrderTicket({ venue, symbol, side, entry, stop, tps, units, leverage = 1 }: { venue: VenueId; symbol: string; side: "LONG" | "SHORT"; entry: number; stop: number; tps: number[]; units: number | null; leverage?: number }) {
  const vm = VENUE_META[venue];
  const pair = vm.instrument(symbol, vm.quotes[0]);
  const long = side === "LONG";
  const [u, setU] = useState(units ? String(+units.toFixed(6)) : "");
  const n = Number(u.replace(",", ".")) || 0;
  const parts = [0.3, 0.3, 0.4];
  const stopLimit = long ? stop * 0.995 : stop * 1.005;
  const rows: { label: string; order: string; note?: string }[] = [
    { label: "1. Entry", order: `${long ? "BUY" : "SELL"} ${pair} · Limit · price ${fmtUsd(entry)}${n ? ` · amount ${fmtNum(n, 6)} ${symbol}` : ""}${leverage > 1 ? ` · ${leverage}x isolated` : ""}`, note: "Place it inside the entry zone. If price is already past the zone, do not chase: set the limit at the zone edge and wait." },
    { label: "2. Stop loss", order: `${long ? "SELL" : "BUY"} ${pair} · Stop-limit · stop ${fmtUsd(stop)} · limit ${fmtUsd(stopLimit)}${n ? ` · amount ${fmtNum(n, 6)} ${symbol}` : ""}`, note: `Right after the entry fills. The limit sits ${long ? "0.5% under" : "0.5% over"} the stop so it fills in a fast move. On exchanges with "attached" or "bracket" orders (Coinbase Advanced, Bybit, OKX), add it on the entry ticket instead.` },
    ...tps.map((tp, i) => ({ label: `${i + 3}. Take profit ${i + 1}`, order: `${long ? "SELL" : "BUY"} ${pair} · Limit · price ${fmtUsd(tp)}${n ? ` · amount ${fmtNum(n * parts[i], 6)} ${symbol} (${Math.round(parts[i] * 100)}%)` : ` · ${Math.round(parts[i] * 100)}% of the position`}`, note: i === 0 ? "When this fills, move the stop-loss order to the entry price (break-even)." : i === 1 ? "When this fills, trail the stop under the last swing low (or over the last swing high on a short)." : "Let the last part run to here; cancel any remaining stop after it fills." })),
  ];
  return (
    <div className="card space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Order ticket on {vm.label}</div>
        <label className="flex items-center gap-1 text-xs text-fg-3">Amount ({symbol})<input inputMode="decimal" className="num !w-32 !py-1" placeholder="units" value={u} onChange={(e) => setU(e.target.value)} /></label>
      </div>
      {!n ? <p className="text-xs text-fg-3">Enter your amount in {symbol} (from the position size calculator or "I took this trade") and every line fills in.</p> : null}
      <ol className="space-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.label} className="rounded-lg border border-border bg-bg-2 p-2">
            <div className="text-fg-3">{r.label}</div>
            <div className="num mt-0.5 font-medium text-fg">{r.order}</div>
            {r.note ? <div className="mt-0.5 text-fg-2">{r.note}</div> : null}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-fg-3">Sizes assume the 30 / 30 / 40 split. {vm.canShort ? "" : `${vm.label} is spot only: SHORT tickets cannot be placed there.`} Check the minimum order size on the pair; tiny splits may be below it, in which case use two parts instead of three.</p>
    </div>
  );
}
