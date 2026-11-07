"use client";

import { useEffect, useState } from "react";
import { VENUE_IDS, VENUE_META, type VenueId } from "@/lib/venues";
import { currentVenue, setVenue, VENUE_EVENT } from "@/lib/venue-pref";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Active exchange switch. compact = a select for menus; full = cards for the settings page. */
export default function VenuePicker({ compact = false }: { compact?: boolean }) {
  const [v, setV] = useState<VenueId>("binance");
  useEffect(() => {
    setV(currentVenue());
    const on = () => setV(currentVenue());
    window.addEventListener(VENUE_EVENT, on);
    return () => window.removeEventListener(VENUE_EVENT, on);
  }, []);
  const pick = async (id: VenueId) => {
    setVenue(id);
    setV(id);
    const sb = supabaseBrowser();
    if (sb && (await sb.auth.getUser()).data.user) fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { venue: id } }) }).catch(() => {});
  };
  if (compact) {
    return (
      <select aria-label="Active exchange" className="!w-auto !py-1.5 text-xs" value={v} onChange={(e) => pick(e.target.value as VenueId)}>
        {VENUE_IDS.map((x) => <option key={x} value={x}>{VENUE_META[x].label}</option>)}
      </select>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {VENUE_IDS.map((x) => {
        const m = VENUE_META[x];
        return (
          <button key={x} onClick={() => pick(x)} className={`card flex items-start gap-3 p-3 text-left ${v === x ? "!border-mint" : ""}`} aria-pressed={v === x}>
            <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: m.color }} />
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-medium">{m.label}{v === x ? <span className="pill pill-mint">active</span> : null}</span>
              <span className="block text-[11px] leading-snug text-fg-3">{m.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
