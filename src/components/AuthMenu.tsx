"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getWatchlist, setWatchlistSignedIn, syncFromAccount } from "@/lib/watchlist";

export default function AuthMenu() {
  const sb = supabaseBrowser();
  const router = useRouter();
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
      if (data.user) syncFromAccount();
      else setWatchlistSignedIn(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
      setEmail(session?.user?.email ?? null);
      if (event === "SIGNED_IN") {
        // one-time merge of the guest watchlist into the account
        const guest = getWatchlist();
        if (guest.length) {
          await fetch("/api/me/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: guest }) });
        }
        await syncFromAccount();
        router.refresh();
      }
      if (event === "SIGNED_OUT") {
        setWatchlistSignedIn(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, router]);

  if (!sb || !ready) return null;
  if (!email)
    return (
      <Link href="/login" className="btn-ghost whitespace-nowrap">Sign in</Link>
    );
  return (
    <div className="flex items-center gap-2">
      <Link href="/setups" className="hidden text-xs text-fg-2 hover:text-fg sm:block">{email}</Link>
      <button
        className="btn-ghost"
        onClick={async () => {
          await sb.auth.signOut();
          router.refresh();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
