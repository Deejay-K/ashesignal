"use client";

import { useEffect, useState } from "react";

/** Account-level risk limits used by portfolio heat (max % of account at risk, max open trades). */
export default function RiskLimits() {
  const [maxHeatPct, setHeat] = useState("3");
  const [maxOpen, setOpen] = useState("3");
  const [saved, setSaved] = useState(false);
  useEffect(() => { fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => { const p = j?.profile?.preferences ?? {}; if (p.maxHeatPct) setHeat(String(p.maxHeatPct)); if (p.maxOpen) setOpen(String(p.maxOpen)); }).catch(() => {}); }, []);
  const save = async () => { await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { maxHeatPct: Number(maxHeatPct) || 3, maxOpen: Number(maxOpen) || 3 } }) }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return (
    <div id="limits" className="space-y-2 text-sm">
      <p className="text-xs text-fg-2">Limits across all open journal trades. The journal and the "I took this trade" dialog warn when a new trade would cross them. Defaults: 3% of the account at risk in total, 3 trades at once.</p>
      <div className="grid grid-cols-2 gap-2 text-xs text-fg-3">
        <label>Max total risk (% of trading balance)<input inputMode="decimal" className="num" value={maxHeatPct} onChange={(e) => setHeat(e.target.value)} /></label>
        <label>Max open trades<input inputMode="numeric" className="num" value={maxOpen} onChange={(e) => setOpen(e.target.value)} /></label>
      </div>
      <button className="btn-ghost text-xs" onClick={save}>{saved ? "Saved" : "Save limits"}</button>
    </div>
  );
}
