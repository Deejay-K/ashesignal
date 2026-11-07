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
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [supported, setSupported] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(false);

  useEffect(() => {
    fetch("/api/me/push")
      .then((r) => r.json())
      .then((j) => {
        setKey(j.publicKey);
        setEmailAvail(j.email);
      });
    fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.profile && setNotifyEmail(!!j.profile.notify_email));
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      return setSupported(false);
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then(setSub)
      .catch(() => setSupported(false));
  }, []);

  const enable = async () => {
    if (!key) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted")
        return setMsg("Notifications were blocked in the browser.");
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64(key),
      });
      const r = await fetch("/api/me/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: s.toJSON() }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setSub(s);
      setMsg("Push enabled on this device.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const disable = async () => {
    if (!sub) return;
    await fetch(`/api/me/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
      method: "DELETE",
    });
    await sub.unsubscribe();
    setSub(null);
    setMsg("Push disabled on this device.");
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-fg-3">Push (this device)</span>
        {!supported ? (
          <span className="text-fg-3">
            Not supported in this browser. On iPhone, add the site to the Home
            Screen first.
          </span>
        ) : !key ? (
          <span className="text-fg-3">
            Not configured on the server (VAPID keys - SETUP.md step 6).
          </span>
        ) : sub ? (
          <button className="btn-ghost" onClick={disable}>
            Disable
          </button>
        ) : (
          <button className="btn" onClick={enable}>
            Enable push
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-fg-3">Email</span>
        {!emailAvail ? (
          <span className="text-fg-3">
            Not configured on the server (RESEND_API_KEY).
          </span>
        ) : (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="w-auto"
              checked={notifyEmail}
              onChange={async (e) => {
                setNotifyEmail(e.target.checked);
                await fetch("/api/me/push", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ notifyEmail: e.target.checked }),
                });
              }}
            />{" "}
            Email me when alerts fire
          </label>
        )}
      </div>
      {msg ? <p className="text-xs text-fg-2">{msg}</p> : null}
      <p className="text-xs text-fg-3">
        Every fired alert also appears in the in-app inbox on the Alerts page
        regardless of these settings.
      </p>
    </div>
  );
}
