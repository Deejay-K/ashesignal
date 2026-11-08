"use client";

import { useEffect, useState } from "react";

/** Link a Telegram chat: show a code, user sends /link CODE to the bot. */
export default function TelegramSettings() {
  const [s, setS] = useState<{ enabled: boolean; linked?: boolean; code?: string | null; bot?: string | null } | null>(null);
  const load = () => fetch("/api/me/telegram").then((r) => (r.ok ? r.json() : { enabled: false })).then(setS).catch(() => setS({ enabled: false }));
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);
  if (!s) return null;
  if (!s.enabled) return <p className="text-xs text-fg-3">Not configured on this deployment. Create a bot with @BotFather, set TELEGRAM_BOT_TOKEN in Vercel, redeploy and open /api/telegram/setup?secret=... once (docs/SETUP.md section 25).</p>;
  return (
    <div className="space-y-2 text-sm">
      {s.linked ? (
        <>
          <p className="text-fg-2">Connected{s.bot ? ` to ${s.bot}` : ""}. Alerts, the daily digest and the weekly review arrive in Telegram, and you can ask the bot /trades, /today, /me, /coin SOL or any question.</p>
          <button className="btn-ghost text-xs" onClick={async () => { await fetch("/api/me/telegram", { method: "DELETE" }); load(); }}>Disconnect</button>
        </>
      ) : (
        <>
          <p className="text-xs text-fg-2">1. Open {s.bot ? <a className="link" href={`https://t.me/${s.bot.replace("@", "")}`} target="_blank" rel="noreferrer">{s.bot}</a> : "the bot"} in Telegram and press Start. 2. Send this message:</p>
          <div className="num inline-block rounded-lg border border-mint/40 bg-mint-dim px-3 py-2 text-base font-semibold tracking-wider">/link {s.code}</div>
          <p className="text-xs text-fg-3">This page updates by itself once the bot confirms. The code is single use.</p>
        </>
      )}
    </div>
  );
}
