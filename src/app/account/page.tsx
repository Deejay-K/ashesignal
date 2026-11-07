"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Empty, Section } from "@/components/ui";
import PushToggle from "@/components/PushToggle";

export default function AccountPage() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [counts, setCounts] = useState<{ watch: number; setups: number; alerts: number } | null>(null);

  useEffect(() => {
    if (!sb) return setEmail(null);
    sb.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? null);
      if (!data.user) return;
      const [w, s, a] = await Promise.all([fetch("/api/me/watchlist").then((r) => r.json()), fetch("/api/me/setups").then((r) => r.json()), fetch("/api/me/alerts").then((r) => r.json())]);
      setCounts({ watch: w.items?.length ?? 0, setups: s.setups?.length ?? 0, alerts: a.alerts?.length ?? 0 });
    });
  }, [sb]);

  if (email === undefined) return <div className="h-32 animate-pulse rounded-lg bg-bg-3" />;
  if (!sb) return <Empty>Accounts are not configured on this deployment (docs/SETUP.md step 3).</Empty>;
  if (!email)
    return (
      <Section title="Not signed in">
        <p className="text-sm text-fg-2">You are in <b>guest mode</b>. Watchlist and risk profile live in this browser only; setups and alerts are not saved.</p>
        <Link href="/login" className="btn mt-3 inline-block text-sm">Sign in</Link>
      </Section>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-mint text-xl font-bold text-[#06281d]">{email[0].toUpperCase()}</span>
        <div>
          <h1 className="text-xl font-bold">Signed in</h1>
          <p className="text-sm text-fg-2">{email}</p>
        </div>
        <button className="btn-ghost ml-auto" onClick={async () => { await sb.auth.signOut(); router.push("/"); router.refresh(); }}>Sign out</button>
      </div>
      <div className="num grid grid-cols-3 gap-3">
        {[["Watchlist", counts?.watch, "/watchlist"], ["Saved setups", counts?.setups, "/setups"], ["Alerts", counts?.alerts, "/alerts"]].map(([k, v, href]) => (
          <Link key={String(k)} href={String(href)} className="card p-3 hover:border-mint"><div className="text-[11px] uppercase tracking-wider text-fg-3">{k}</div><div className="text-lg font-semibold">{v ?? "…"}</div></Link>
        ))}
      </div>
      <Section title="Notifications">
        <PushToggle />
      </Section>
      <Section title="Synced to this account">
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
          <li>Watchlist (merged with your guest list on first sign-in)</li>
          <li>Saved setups and their outcomes - auto-resolved against live price every few minutes</li>
          <li>Risk profile on the Risk page (balance, risk %, exposure, leverage)</li>
          <li>Alerts and notification preferences</li>
          <li>Wallets (public addresses) and portfolio history</li>
          <li>Multiple watchlists, private token notes, default chart timeframe & overlays</li>
        </ul>
      </Section>
    </div>
  );
}
