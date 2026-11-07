"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "ashesignal.welcome.dismissed";

export default function Welcome() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!localStorage.getItem(KEY)); } catch {}
  }, []);
  if (!show) return null;
  return (
    <div className="card relative border-l-4 border-mint p-4">
      <button className="absolute right-3 top-2 text-fg-3 hover:text-fg" aria-label="Dismiss" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setShow(false); }}>×</button>
      <h2 className="font-semibold">Welcome to AsheSignal</h2>
      <ol className="mt-2 grid gap-2 text-sm text-fg-2 sm:grid-cols-3">
        <li><b className="text-fg">1. Pick a coin.</b> Search any name, ticker or contract address, or open one from the lists below.</li>
        <li><b className="text-fg">2. Read the chart.</b> Patterns are drawn on it; the card beside it gives entry, targets, stops, leverage and why.</li>
        <li><b className="text-fg">3. Size it.</b> "Size this trade" turns the setup into a position that fits your risk. Check the conditions banner first.</li>
      </ol>
      <p className="mt-2 text-xs text-fg-3">Guest mode works without an account. <Link href="/login" className="link">Sign in</Link> to sync watchlists, alerts, saved setups and portfolio. Terms explained in the <Link href="/glossary" className="link">glossary</Link>.</p>
    </div>
  );
}
