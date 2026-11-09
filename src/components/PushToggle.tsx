"use client";

import { useEffect, useState } from "react";

function urlB64(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function PushToggle() {
  const [key, setKey] = useState<string | null>(null);
  const [emailAvail, setEmailAvail] = useState(false);
  const [digest, setDigest] = useState(false);
  const [plan, setPlan] = useState(false);
  const [planHour, setPlanHour] = useState(12);
  const [digestHour, setDigestHour] = useState(13);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [supported, setSupported] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(false);

  useEffect(() => {
    fetch("/api/me/push").then((r) => r.json()).then((j) => { setKey(j.publicKey); setEmailAvail(j.email); });
    fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j?.profile) return; setNotifyEmail(!!j.profile.notify_email); setDigest(!!j.profile.digest_enabled); if (j.profile.digest_hour != null) setDigestHour(Number(j.profile.digest_hour)); setPlan(!!j.profile.plan_enabled); if (j.profile.plan_hour != null) setPlanHour(Number(j.profile.plan_hour)); });
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setSupported(false);
    navigator.serviceWorker.register("/sw.js").then((reg) => reg.pushManager.getSubscription()).then(setSub).catch(() => setSupported(false));
  }, []);

  const enable = async () => {
    if (!key) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setMsg("Notifications were blocked in the browser.");
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      const r = await fetch("/api/me/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: s.toJSON() }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSub(s);
      setMsg("Push enabled on this device.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const disable = async () => {
    if (!sub) return;
    await fetch(`/api/me/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
    await sub.unsubscribe();
    setSub(null);
    setMsg("Push disabled on this device.");
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-fg-3">Push (this device)</span>
        {!supported ? <span className="text-fg-3">Not supported in this browser. On iPhone, add the site to the Home Screen first.</span> : !key ? <span className="text-fg-3">Not configured on the server (VAPID keys - SETUP.md step 6).</span> : sub ? <button className="btn-ghost" onClick={disable}>Disable</button> : <button className="btn" onClick={enable}>Enable push</button>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-fg-3">Email</span>
        {!emailAvail ? <span className="text-fg-3">Not configured on the server (RESEND_API_KEY).</span> : (
          <label className="flex items-center gap-2"><input type="checkbox" className="w-auto" checked={notifyEmail} onChange={async (e) => { setNotifyEmail(e.target.checked); await fetch("/api/me/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notifyEmail: e.target.checked }) }); }} /> Email me when alerts fire</label>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-28 text-fg-3">Daily digest</span>
        <div className="min-w-0 flex-1">
          <div className="rounded-lg border border-border bg-bg-2 p-2 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" className="w-auto" checked={digest} onChange={async (e) => { setDigest(e.target.checked); await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest_enabled: e.target.checked }) }); }} /> Daily digest: conditions, Confirmed trades on my exchange, my open trades</label>
            {digest ? <label className="mt-1 flex items-center gap-2 text-fg-3">Send at <select className="!w-auto !py-1" value={String(digestHour)} onChange={async (e) => { const h = Number(e.target.value); setDigestHour(h); await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest_hour: h }) }); }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC ({new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} local)</option>)}</select></label> : null}
            <p className="mt-1 text-fg-3">Delivered by push and the inbox, plus email when that is on. The worker checks every hour.</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-28 text-fg-3">Morning plan</span>
        <div className="min-w-0 flex-1">
          <div className="rounded-lg border border-border bg-bg-2 p-2 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" className="w-auto" checked={plan} onChange={async (e) => { setPlan(e.target.checked); await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_enabled: e.target.checked }) }); }} /> Send me Today's plan every morning: stance, what to do with each open trade, confirmed setups in zone, risk budget</label>
            {plan ? <label className="mt-1 flex items-center gap-2 text-fg-3">Send at <select className="!w-auto !py-1" value={String(planHour)} onChange={async (e) => { const h = Number(e.target.value); setPlanHour(h); await fetch("/api/me/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_hour: h }) }); }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC ({new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} local)</option>)}</select></label> : null}
            <p className="mt-1 text-fg-3">Same content as the Plan page and the bot's /plan, delivered by push, email (when on) and Telegram.</p>
          </div>
        </div>
      </div>
      {msg ? <p className="text-xs text-fg-2">{msg}</p> : null}
      <p className="text-xs text-fg-3">Every fired alert also appears in the in-app inbox on the Alerts page regardless of these settings.</p>
    </div>
  );
}
