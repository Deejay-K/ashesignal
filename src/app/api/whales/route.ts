import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Recent large transfers across tracked tokens (last 48h), grouped per token with net exchange flow. */
export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ events: [], tokens: [], note: "Whale tracking needs the worker (SUPABASE_SERVICE_ROLE_KEY)." });
  const hours = Number(req.nextUrl.searchParams.get("hours") ?? 48);
  const { data } = await sb.from("whale_events").select("*").gte("occurred_at", new Date(Date.now() - hours * 3_600_000).toISOString()).order("value_usd", { ascending: false }).limit(300);
  const byTok = new Map<string, { chain: string; address: string; symbol: string | null; count: number; totalUsd: number; inflowUsd: number; outflowUsd: number; largestUsd: number }>();
  for (const e of data ?? []) {
    const k = `${e.chain}:${e.token_address}`;
    const t = byTok.get(k) ?? { chain: e.chain, address: e.token_address, symbol: e.symbol, count: 0, totalUsd: 0, inflowUsd: 0, outflowUsd: 0, largestUsd: 0 };
    t.count++;
    t.totalUsd += Number(e.value_usd);
    if (e.kind === "exchange_in") t.inflowUsd += Number(e.value_usd);
    if (e.kind === "exchange_out") t.outflowUsd += Number(e.value_usd);
    t.largestUsd = Math.max(t.largestUsd, Number(e.value_usd));
    byTok.set(k, t);
  }
  return NextResponse.json({ events: (data ?? []).slice(0, 60), tokens: [...byTok.values()].sort((a, b) => b.totalUsd - a.totalUsd), hours });
}
