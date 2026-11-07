"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Section } from "@/components/ui";

export default function LoginPage() {
  const sb = supabaseBrowser();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  if (!sb)
    return (
      <Section title="Accounts not configured">
        <p className="text-sm text-fg-2">Supabase env vars are missing, so AsheSignal is running in guest mode. See <code>docs/SETUP.md</code> step 3 to enable sign-in.</p>
      </Section>
    );

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-bold">Sign in</h1>
        <p className="text-sm text-fg-2">Accounts sync your watchlist, saved setups and risk profile across devices. Guest mode keeps working without one.</p>
      </div>
      <Section title="Magic link">
        {sent ? (
          <p className="text-sm text-mint">Check your inbox — the link signs you in on this device.</p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
              setBusy(false);
              if (error) setErr(error.message);
              else setSent(true);
            }}
          >
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn" disabled={busy}>Send link</button>
          </form>
        )}
      </Section>
      <Section title="Or">
        <button
          className="btn-ghost w-full"
          onClick={async () => {
            const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
            if (error) setErr(error.message);
          }}
        >
          Continue with Google
        </button>
        <p className="mt-2 text-xs text-fg-3">Google only works after you enable the provider in Supabase (SETUP.md step 3c). Magic link works immediately.</p>
      </Section>
      {err ? <p className="text-sm text-red">{err}</p> : null}
    </div>
  );
}
