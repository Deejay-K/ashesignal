"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Section } from "./ui";

export default function TokenNotes({ assetKey, symbol }: { assetKey: string; symbol: string }) {
  const [state, setState] = useState<"loading" | "guest" | "off" | "ok">("loading");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    fetch(`/api/me/notes?key=${encodeURIComponent(assetKey)}`).then(async (r) => {
      if (r.status === 501) return setState("off");
      if (r.status === 401) return setState("guest");
      setNote((await r.json()).note ?? "");
      setState("ok");
    }).catch(() => setState("off"));
  }, [assetKey]);
  if (state === "off" || state === "loading") return null;
  const onChange = (v: string) => {
    setNote(v);
    setSaved("saving");
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      await fetch("/api/me/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: assetKey, symbol, note: v }) });
      setSaved("saved");
    }, 800);
  };
  return (
    <Section title="My notes" right={state === "ok" ? <span className="text-xs text-fg-3">{saved === "saving" ? "saving…" : saved === "saved" ? "saved" : "private · autosaves"}</span> : null}>
      {state === "guest" ? <p className="text-sm text-fg-3"><Link href="/login" className="link">Sign in</Link> to keep private notes on this token.</p> : (
        <textarea value={note} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={`Thesis, levels you care about, why you're watching ${symbol}…`} className="w-full rounded-lg border border-border bg-bg-3 p-3 text-sm text-fg outline-none focus:border-mint" />
      )}
    </Section>
  );
}
