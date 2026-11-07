"use client";

import { useEffect, useState } from "react";
import { THEMES, applyTheme, currentTheme } from "@/lib/themes";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  const [t, setT] = useState("foundry");
  useEffect(() => {
    setT(currentTheme());
    const on = () => setT(currentTheme());
    window.addEventListener("theme-change", on);
    return () => window.removeEventListener("theme-change", on);
  }, []);
  const pick = async (id: string) => {
    applyTheme(id);
    setT(id);
    const sb = supabaseBrowser();
    if (sb && (await sb.auth.getUser()).data.user) fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { theme: id } }) }).catch(() => {});
  };
  if (compact) {
    return (
      <select aria-label="Theme" className="!w-auto !py-1.5 text-xs" value={t} onChange={(e) => pick(e.target.value)}>
        {THEMES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {THEMES.map((x) => {
        const v = x.vars;
        const sw = (k: string, fb: string) => v[k] ?? fb;
        return (
          <button key={x.id} onClick={() => pick(x.id)} className={`card flex items-center gap-3 p-3 text-left ${t === x.id ? "!border-mint" : ""}`} style={{ background: sw("--bg-2", "#10161d"), borderColor: t === x.id ? sw("--mint", "#36bd94") : sw("--border", "#1f2a35"), color: sw("--fg", "#e6edf3") }}>
            <span className="flex shrink-0 gap-1">
              <span className="h-8 w-3 rounded" style={{ background: sw("--mint", "#36bd94") }} />
              <span className="h-8 w-3 rounded" style={{ background: sw("--red", "#f0506e") }} />
              <span className="h-8 w-3 rounded" style={{ background: sw("--amber", "#f2b544") }} />
              <span className="h-8 w-3 rounded" style={{ background: sw("--bg-3", "#161e27") }} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold" style={{ fontFamily: x.font === "mono" ? "ui-monospace, monospace" : undefined }}>{x.name}{t === x.id ? " ✓" : ""}</span>
              <span className="block text-xs" style={{ color: sw("--fg-2", "#9fb0c0") }}>{x.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
