"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import VenuePicker from "@/components/VenuePicker";
import RiskLimits from "@/components/RiskLimits";
import PushToggle from "@/components/PushToggle";
import TelegramSettings from "@/components/TelegramSettings";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Disclaimer } from "@/components/ui";

const STEPS = [
  { id: "exchange", title: "1. Your exchange", why: "Everything (confirmed trades, order tickets, the bot) is filtered to what you can actually place. Coinbase is spot only: longs." },
  { id: "risk", title: "2. Balance and risk limits", why: "The size calculator, portfolio heat and the pre-trade check all need your trading balance and how much you risk per trade. 1% is the default for a reason." },
  { id: "notify", title: "3. Notifications", why: "Push for the moment a trade confirms, the morning plan at your hour, and the daily digest. Everything also lands in the in-app inbox." },
  { id: "telegram", title: "4. Telegram bot", why: "Link @AsheSignalBot and every confirmed trade arrives as a message with the chart, the copy-trade block and buttons to record it." },
  { id: "first", title: "5. Your first look", why: "Read today's plan, open a confirmed setup, run the pre-trade check, and record it with 'I took this trade' (or as a paper trade) so the journal can grade you." },
];

/** Five-step setup wizard for a new account. Each step is the real settings component, not a copy. */
export default function WelcomePage() {
  const [i, setI] = useState(0);
  const [guest, setGuest] = useState<boolean | null>(null);
  useEffect(() => { const sb = supabaseBrowser(); if (!sb) { setGuest(true); return; } sb.auth.getUser().then((r) => setGuest(!r.data.user)); }, []);
  const step = STEPS[i];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Welcome to AsheSignal</h1>
        <p className="text-sm text-fg-2">Five minutes of setup so the platform works for your exchange, your account size and your phone. AsheSignal finds and grades setups; you place every order yourself.</p>
      </div>
      <ol className="flex flex-wrap gap-1 text-xs">{STEPS.map((s, k) => <li key={s.id}><button className={`btn-ghost !py-1 ${k === i ? "!border-mint !text-mint" : ""}`} onClick={() => setI(k)}>{s.title}</button></li>)}</ol>
      <div className="card space-y-3 p-4">
        <div><div className="font-semibold">{step.title}</div><p className="text-sm text-fg-2">{step.why}</p></div>
        {guest && step.id !== "exchange" ? <p className="rounded-lg border border-amber/40 bg-amber-dim p-2 text-sm text-amber">This step needs an account (free). <Link href="/login" className="link">Sign in</Link>, then come back to /welcome.</p> : null}
        {step.id === "exchange" ? <VenuePicker /> : null}
        {step.id === "risk" && !guest ? <RiskLimits /> : null}
        {step.id === "notify" && !guest ? <PushToggle /> : null}
        {step.id === "telegram" && !guest ? <TelegramSettings /> : null}
        {step.id === "first" ? (
          <div className="flex flex-wrap gap-2">
            <Link className="btn" href="/plan">Open today&apos;s plan</Link>
            <Link className="btn-ghost" href="/opportunities?cat=confirmed">Confirmed trades</Link>
            <Link className="btn-ghost" href="/guide">How to place a trade</Link>
            <Link className="btn-ghost" href="/simulator">What the rules would have done</Link>
          </div>
        ) : null}
        <div className="flex justify-between pt-2">
          <button className="btn-ghost text-sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          {i < STEPS.length - 1 ? <button className="btn text-sm" onClick={() => setI(i + 1)}>Next</button> : <Link className="btn text-sm" href="/plan">Done</Link>}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
