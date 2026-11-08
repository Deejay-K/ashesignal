"use client";

import { useState } from "react";

/** One-click "tell me when this coin enters Confirmed Trades" (per-coin new_confirmed alert). */
export default function ConfirmAlertButton({ symbol, coingeckoId, className = "link" }: { symbol: string; coingeckoId: string; className?: string }) {
  const [st, setSt] = useState<"idle" | "busy" | "done" | "guest" | "err">("idle");
  const arm = async () => {
    setSt("busy");
    try {
      const r = await fetch("/api/me/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "new_confirmed", symbol, assetKey: `cg:${coingeckoId}`, params: {}, assetRef: { symbol, id: coingeckoId }, channels: ["push", "email", "telegram"], cooldownMinutes: 240 }) });
      setSt(r.status === 401 ? "guest" : r.ok ? "done" : "err");
    } catch { setSt("err"); }
  };
  if (st === "done") return <span className="text-[11px] text-fg-3">alert set</span>;
  if (st === "guest") return <a className={className} href="/login">sign in for alerts</a>;
  return <button className={className} disabled={st === "busy"} onClick={arm} title="Push, email or Telegram when the engine moves this coin into Confirmed Trades on any timeframe.">{st === "err" ? "retry alert" : "alert when it confirms"}</button>;
}
