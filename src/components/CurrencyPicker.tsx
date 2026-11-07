"use client";
import { CURRENCIES, useCurrency } from "@/lib/currency";

export default function CurrencyPicker() {
  const { currency, setCurrency, rate } = useCurrency();
  return (
    <label className="flex items-center gap-2 text-xs text-fg-3">
      Display currency
      <select className="!w-auto !py-1 text-xs" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      {currency !== "USD" ? <span className="num">1 USD = {rate.toFixed(4)} {currency}</span> : null}
    </label>
  );
}
