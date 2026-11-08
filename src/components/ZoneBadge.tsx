"use client";

import { useState } from "react";
import { zoneStatus } from "@/lib/trade-check";

/** Where price sits versus the entry zone, plus a one-click "tell me when price enters the zone" alert. */
export default function ZoneBadge({ price, entry, side, symbol, assetKey, timeframe }: { price: number | null; entry: { low: number; high: number } | null; side: "LONG" | "SHORT" | null; symbol: string; assetKey?: string; timeframe?: string | null }) {
  const z = zoneStatus(price, entry, side);
  const [st, setSt] = useState<"idle" | "busy" | "done" | "guest" | "err">("idle");
  if (z.state === "unknown") return null;
  const cls = z.tone === "up" ? "pill-mint" : z.tone === "down" ? "pill-red" : z.tone === "amber" ? "pill-amber" : "pill-gray";
  const arm = async () => {
    setSt("busy");
    try {
      const r = await fetch("/api/me/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "entry_zone", symbol, assetKey, timeframe: timeframe ?? "1h", params: { low: entry!.low, high: entry!.high, side }, assetRef: { symbol, id: assetKey?.replace(/^cg:/, "") }, channels: ["push", "email", "telegram"] }) });
      setSt(r.status === 401 ? "guest" : r.ok ? "done" : "err");
    } catch { setSt("err"); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className={`pill ${cls}`} title={z.advice}>{z.label}</span>
      {z.state !== "in" ? (
        st === "done" ? <span className="text-fg-3">alert set</span>
        : st === "guest" ? <a className="link" href="/login">sign in to be alerted</a>
        : st === "err" ? <span className="text-red">alert failed</span>
        : <button className="link" disabled={st === "busy"} onClick={arm} title="One alert when price comes into the entry zone, delivered to your push, email or Telegram.">tell me when it enters the zone</button>
      ) : null}
    </span>
  );
}
