"use client";
// Display currency for personal-money pages (portfolio, risk, exchanges). Market data stays in USD.
import { useEffect, useState } from "react";

export const CURRENCY_KEY = "ashesignal.currency";
export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "CHF", "BRL", "INR", "MXN"];
const SYMBOL: Record<string, string> = { USD: "$", CAD: "CA$", EUR: "€", GBP: "£", AUD: "A$", JPY: "¥", CHF: "CHF ", BRL: "R$", INR: "₹", MXN: "MX$" };
let rates: Record<string, number> = { USD: 1 };
let loaded = false;

export function getCurrency(): string {
  try { return localStorage.getItem(CURRENCY_KEY) || "USD"; } catch { return "USD"; }
}
export function setCurrency(c: string) {
  try { localStorage.setItem(CURRENCY_KEY, c); } catch {}
  window.dispatchEvent(new Event("currency-change"));
}
async function ensureRates() {
  if (loaded) return;
  loaded = true;
  try { const j = await fetch("/api/fx").then((r) => r.json()); if (j.rates) rates = j.rates; } catch {}
  window.dispatchEvent(new Event("currency-change"));
}

/** Hook returning a formatter that converts USD amounts into the chosen display currency. */
export function useCurrency() {
  const [cur, setCur] = useState("USD");
  const [, tick] = useState(0);
  useEffect(() => {
    setCur(getCurrency());
    ensureRates();
    const on = () => { setCur(getCurrency()); tick((t) => t + 1); };
    window.addEventListener("currency-change", on);
    return () => window.removeEventListener("currency-change", on);
  }, []);
  const rate = rates[cur] ?? 1;
  const fmt = (usd: number | null | undefined, opts: { compact?: boolean } = {}) => {
    if (usd == null || !Number.isFinite(usd)) return "-";
    const v = usd * rate;
    const sym = SYMBOL[cur] ?? cur + " ";
    const a = Math.abs(v);
    if (opts.compact) {
      if (a >= 1e9) return `${sym}${(v / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `${sym}${(v / 1e6).toFixed(2)}M`;
      if (a >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}K`;
    }
    if (a >= 1000) return `${sym}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    if (a >= 1) return `${sym}${v.toFixed(2)}`;
    if (a >= 0.01) return `${sym}${v.toFixed(4)}`;
    return `${sym}${v.toPrecision(3)}`;
  };
  return { currency: cur, rate, fmt, setCurrency };
}
