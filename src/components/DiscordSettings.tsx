"use client";

import { useEffect, useState } from "react";

/** Discord webhook: alerts, digest and weekly review posted to a channel the user controls. */
export default function DiscordSettings() {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [has, setHas] = useState(false);
  useEffect(() => { fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.profile?.discord_webhook) { setHas(true); setUrl(j.profile.discord_webhook); } }).catch(() => {}); }, []);
  const save = async (v: string | null) => {
    const r = await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ discord_webhook: v }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setSaved(j.error ?? "Could not save");
    setHas(!!v); if (!v) setUrl("");
    setSaved(v ? "Saved. Future alerts, digests and weekly reviews post there too." : "Removed.");
    setTimeout(() => setSaved(null), 3000);
  };
  const test = async () => { const r = await fetch("/api/me/discord-test", { method: "POST" }); const j = await r.json().catch(() => ({})); setSaved(r.ok ? "Test message sent; check the channel." : j.error ?? "Test failed"); };
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-fg-2">Post everything AsheSignal sends you into a Discord channel. In Discord: channel settings &gt; Integrations &gt; Webhooks &gt; New Webhook &gt; Copy Webhook URL. Anyone with the URL can post to that channel, so keep it private; it is stored on your profile and used only for your own notifications.</p>
      <div className="flex flex-wrap gap-2">
        <input className="min-w-0 flex-1" placeholder="https://discord.com/api/webhooks/..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn text-xs" onClick={() => save(url)}>{has ? "Update" : "Connect"}</button>
        {has ? <button className="btn-ghost text-xs" onClick={test}>Send test</button> : null}
        {has ? <button className="btn-ghost text-xs" onClick={() => save(null)}>Remove</button> : null}
      </div>
      {saved ? <p className="text-xs text-fg-2">{saved}</p> : null}
    </div>
  );
}
