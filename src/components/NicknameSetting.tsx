"use client";

import { useEffect, useState } from "react";
import { autoAlias, cleanNickname } from "@/lib/nickname";

/** Profile setting: the public nickname shown on the results ticker, and whether this person's trades appear there. */
export default function NicknameSetting({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [hidden, setHidden] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j?.profile) return; setName(j.profile.display_name ?? ""); setHidden(!!j.profile.preferences?.tickerHidden); }).catch(() => {}); }, []);
  const check = cleanNickname(name);
  const shown = check.ok && check.value ? check.value : autoAlias(userId);
  const save = async (patch: { display_name?: string | null; preferences?: { tickerHidden: boolean } }) => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(r?.ok ? { ok: true, text: "Saved. The ticker updates within a minute or two." } : { ok: false, text: j.error ?? "Could not save. Try again." });
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="text-fg-2">This is the only thing other members see about you. It appears next to your closed trades on the results strip at the top of the site. Your email, your balance and the size of your trades are never shown.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 text-xs text-fg-3">Nickname (3 to 20 characters)
          <input className="mt-1 w-full" value={name} maxLength={20} placeholder={autoAlias(userId)} onChange={(e) => { setName(e.target.value); setMsg(null); }} />
        </label>
        <button type="button" className="btn" disabled={busy || !check.ok} onClick={() => check.ok && save({ display_name: check.value })}>Save</button>
      </div>
      {!check.ok ? <p className="text-xs text-red">{check.error}</p> : <p className="text-xs text-fg-3">Others see you as <b className="text-fg">{shown}</b>{check.value ? "" : " (automatic, until you pick a nickname)"}.</p>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto shrink-0" checked={!hidden} onChange={(e) => { const h = !e.target.checked; setHidden(h); save({ preferences: { tickerHidden: h } }); }} /> Show my closed trades (wins and losses) on the results strip</label>
      {msg ? <p className={`text-xs ${msg.ok ? "text-mint" : "text-red"}`}>{msg.text}</p> : null}
    </div>
  );
}
