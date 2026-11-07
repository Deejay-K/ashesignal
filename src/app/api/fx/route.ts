import { NextResponse } from "next/server";
import { fetchJson, safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";
export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "CHF", "BRL", "INR", "MXN"];

/** USD -> other currency rates (frankfurter.app, ECB data, free). Cached 1h. */
export async function GET() {
  const r = await safe(fetchJson<{ rates: Record<string, number> }>(`https://api.frankfurter.app/latest?from=USD&to=${CURRENCIES.filter((c) => c !== "USD").join(",")}`, { provider: "frankfurter", ttl: 3_600_000 }));
  if (!r.ok) return NextResponse.json({ rates: { USD: 1 }, error: r.error }, { status: 200 });
  return NextResponse.json({ rates: { USD: 1, ...r.data.rates }, at: Date.now() });
}
