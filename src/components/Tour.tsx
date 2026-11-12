"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "ashesignal.tour.v1";
const STEPS: { title: string; body: string; cta?: { href: string; label: string } }[] = [
  { title: "Welcome to AsheSignal", body: "AsheSignal reads the crypto market for you and tells you, in plain words, when a trade idea has passed every check. You always place the trade yourself: the app never touches your money." },
  { title: "1. Start with the headline", body: "The line at the top of the dashboard is today's answer: is the market helping or hurting, how many Confirmed trades you can place on your exchange, and the best move for today. Some days the best move is to wait." },
  { title: "2. Confirmed, Watching, Speculative, Spot", body: "Confirmed means every check passed. Watching means close, with the missing piece spelled out. Speculative is high risk. Spot is for buying and holding. When nothing is Confirmed, the app tells you why.", cta: { href: "/opportunities", label: "Open Trading Discovery" } },
  { title: "3. Every trade comes with a plan", body: "Each setup gives an entry zone, a stop and three targets. Size it with the calculator so one loss stays small, then follow the step by step guide for your exchange.", cta: { href: "/risk", label: "Open the size calculator" } },
  { title: "4. Let the app come to you", body: "Turn on alerts or connect the Telegram bot and you get a message when a trade confirms, enters its zone, hits a target or hits its stop. No need to keep refreshing.", cta: { href: "/welcome", label: "Run the guided setup" } },
  { title: "5. Check the record", body: "Every signal the engine sent is graded on the Track record page, losers included. New to trading? The Academy has short lessons with quizzes.", cta: { href: "/track-record", label: "See the track record" } },
];

/** First-visit tour: six short cards. Shown once per device; "Take the tour" in the menu (or /?tour=1) replays it. */
export default function Tour() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    let forced = false;
    try { forced = new URLSearchParams(window.location.search).get("tour") === "1"; } catch { /* ignore */ }
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch { seen = true; }
    if (forced || !seen) setStep(0);
  }, []);
  const close = () => {
    setStep(null);
    try { localStorage.setItem(KEY, "1"); const u = new URL(window.location.href); if (u.searchParams.has("tour")) { u.searchParams.delete("tour"); window.history.replaceState(null, "", u.pathname + (u.search || "")); } } catch { /* ignore */ }
  };
  useEffect(() => {
    if (step == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);
  if (step == null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="tour-back" role="dialog" aria-modal="true" aria-label="AsheSignal tour" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="tour-card">
        <div className="flex items-center justify-between">
          <div className="tour-dots" aria-hidden="true">{STEPS.map((_, i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
          <button type="button" className="text-xs text-fg-3 hover:text-fg" onClick={close}>Skip</button>
        </div>
        <h2 className="mt-3 text-lg font-bold">{s.title}</h2>
        <p className="mt-1 text-sm text-fg-2">{s.body}</p>
        {s.cta ? <Link href={s.cta.href} onClick={close} className="link mt-2 inline-block text-sm">{s.cta.label}</Link> : null}
        <div className="mt-4 flex items-center gap-2">
          {step > 0 ? <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button> : null}
          <button type="button" className="btn ml-auto" onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Start using AsheSignal" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
