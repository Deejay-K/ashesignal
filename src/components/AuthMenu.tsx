"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getWatchlist, setWatchlistSignedIn, syncFromAccount } from "@/lib/watchlist";
import { applyTheme, currentTheme } from "@/lib/themes";

export default function AuthMenu() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sb) {
      setReady(true);
      return;
    }
    sb.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
      if (data.user) {
        syncFromAccount();
        fetch("/api/me/profile").then((r) => (r.ok ? r.json() : null)).then((j) => { const th = j?.profile?.preferences?.theme; if (th && th !== currentTheme()) applyTheme(th); }).catch(() => {});
      } else setWatchlistSignedIn(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
      setEmail(session?.user?.email ?? null);
      if (event === "SIGNED_IN") {
        const guest = getWatchlist();
        if (guest.length) {
          await fetch("/api/me/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: guest }) });
        }
        await syncFromAccount();
        router.refresh();
      }
      if (event === "SIGNED_OUT") {
        setWatchlistSignedIn(false);
        router.refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, router]);

  if (!sb || !ready) return null;
  if (!email) return <Link href="/login" className="btn whitespace-nowrap !py-1.5 text-sm">Sign in</Link>;
  const initial = email[0]?.toUpperCase() ?? "?";
  return (
    <Link href="/account" className={`flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-xs hover:border-mint ${path === "/account" ? "border-mint" : ""}`} title={`Signed in as ${email}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint text-[11px] font-bold text-[#06281d]">{initial}</span>
      <span className="hidden max-w-[160px] truncate text-fg-2 sm:inline">{email}</span>
      <span className="sm:hidden">Account</span>
    </Link>
  );
}
