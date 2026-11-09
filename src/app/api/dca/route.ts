import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { search } from "@/lib/providers/coingecko";
import { planLadder, resolveZone, type DcaWeighting } from "@/lib/dca";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** /api/dca?symbol=SOL&budget=200&count=4&weighting=even[&low=&high=] */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sym = (q.get("symbol") ?? "").trim();
  if (!sym) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const hits = await safe(search(sym.replace(/^\$/, "")));
  const hit = hits.ok ? hits.data.find((h) => h.symbol.toUpperCase() === sym.toUpperCase().replace(/^\$/, "")) ?? hits.data.find((h) => h.id === sym.toLowerCase()) ?? hits.data[0] : null;
  if (!hit) return NextResponse.json({ error: `coin ${sym} not found` }, { status: 404 });
  const coin = { id: hit.id, symbol: hit.symbol.toUpperCase() };
  const z = await resolveZone(supabaseAdmin(), coin);
  if (!z) return NextResponse.json({ error: `no price data for ${coin.symbol} right now` }, { status: 502 });
  const low = Number(q.get("low")), high = Number(q.get("high"));
  const zone = low > 0 && high > low ? { low, high } : z.zone;
  const budget = Math.max(5, Number(q.get("budget")) || 200);
  const plan = planLadder({ symbol: coin.symbol, price: z.price, zone, budget, count: Number(q.get("count")) || 4, weighting: (q.get("weighting") === "heavier-low" ? "heavier-low" : "even") as DcaWeighting, zoneSource: low > 0 && high > low ? "Your custom zone" : z.source, takeProfit: z.takeProfit });
  return NextResponse.json({ ...plan, coingeckoId: coin.id, name: hit.name });
}
