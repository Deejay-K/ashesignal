"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { VENUE_META } from "@/lib/venues";
import { currentVenue } from "@/lib/venue-pref";

interface Msg { role: "user" | "assistant"; text: string; bullets?: string[]; links?: { label: string; href: string }[]; model?: string }

const SUGGEST = (venue: string, path: string) => {
  const base = [`What can I trade on ${venue} right now?`, "Is it a good time to trade today?", "How am I doing this month?", "What is the market regime?", "Which spot picks are in their zone?"];
  const m = path.match(/^\/token\/([^/?]+)/);
  if (m) base.unshift(`What does the engine say about ${decodeURIComponent(m[1])}?`);
  return base.slice(0, 5);
};

/** Floating "Ask" button + drawer. Answers come from /api/ai/ask, grounded in the engine's data. */
export default function AskDrawer() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const venue = VENUE_META[currentVenue()].label;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); }, []);
  if (path.startsWith("/login")) return null;

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ("");
    const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ai/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
      const j = await r.json();
      setMsgs((m) => [...m, r.ok ? { role: "assistant", text: j.text, bullets: j.bullets, links: j.links, model: j.model } : { role: "assistant", text: j.error ?? "Something went wrong." }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", text: "Could not reach the server." }]); }
    setBusy(false);
  };

  return (
    <>
      <button className="ask-fab" onClick={() => setOpen(true)} aria-label="Ask AsheSignal"><span className="ask-fab-dot" />Ask</button>
      {open ? (
        <div className="ask-backdrop" onClick={() => setOpen(false)}>
          <aside className="ask-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ask AsheSignal">
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="ask-fab-dot" />
              <div className="min-w-0">
                <div className="font-semibold">Ask AsheSignal</div>
                <div className="truncate text-[11px] text-fg-3">Answers from the engine&apos;s live data for {venue}. Not financial advice.</div>
              </div>
              <button className="btn-ghost ml-auto !h-8 text-xs" onClick={() => setOpen(false)}>Close</button>
            </header>
            <div className="ask-body">
              {!msgs.length ? (
                <div className="space-y-2 text-sm text-fg-2">
                  <p>I read the same data the app shows: trade conditions, market regime, the engine&apos;s setups and categories, your journal and risk settings when you are signed in. I describe what it shows; the decision stays yours.</p>
                  <div className="flex flex-wrap gap-1.5">{SUGGEST(venue, path).map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
                </div>
              ) : null}
              {msgs.map((m, i) => (
                <div key={i} className={`ask-msg ${m.role === "user" ? "ask-user" : "ask-bot"}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.bullets?.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">{m.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul> : null}
                  {m.links?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{m.links.map((l) => <Link key={l.href} href={l.href} className="chip" onClick={() => setOpen(false)}>{l.label} →</Link>)}</div> : null}
                  {m.model ? <div className="mt-1 text-[10px] text-fg-3">{m.model === "engine-writer" ? "engine writer" : m.model}</div> : null}
                </div>
              ))}
              {busy ? <div className="ask-msg ask-bot text-fg-3">Reading the engine…</div> : null}
              <div ref={endRef} />
            </div>
            <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
              <input className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a coin, today's trades, your journal…" aria-label="Your question" autoFocus />
              <button className="btn" disabled={busy || q.trim().length < 2}>Ask</button>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
