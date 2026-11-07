import { NextResponse } from "next/server";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { buildPortfolio, type ExchangeHoldingInput } from "@/lib/portfolio";
import { ADAPTERS } from "@/lib/exchanges";
import { decrypt, EXCHANGE_KEYS_ENABLED } from "@/lib/exchanges/crypto";
import type { ExchangeId } from "@/lib/exchanges/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily portfolio snapshot for every user with wallets (portfolio history). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const { data: wallets } = await sb.from("wallets").select("*");
  const { data: exch } = EXCHANGE_KEYS_ENABLED() ? await sb.from("exchange_accounts").select("*") : { data: [] };
  const byUser = new Map<string, typeof wallets>();
  for (const w of wallets ?? []) byUser.set(w.user_id, [...(byUser.get(w.user_id) ?? []), w]);
  for (const e of exch ?? []) if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
  let saved = 0;
  for (const [userId, ws] of byUser) {
    // skip users snapshotted in the last 20h
    const { data: last } = await sb.from("holdings_snapshots").select("taken_at").eq("user_id", userId).order("taken_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.taken_at).getTime() < 20 * 3_600_000) continue;
    const exHoldings: ExchangeHoldingInput[] = [];
    for (const r of (exch ?? []).filter((x) => x.user_id === userId)) {
      try {
        const bals = await ADAPTERS[r.exchange as ExchangeId].balances({ key: decrypt(r.enc_key), secret: decrypt(r.enc_secret), passphrase: r.enc_passphrase ? decrypt(r.enc_passphrase) : undefined });
        for (const b of bals) exHoldings.push({ exchange: r.exchange, label: r.label, asset: b.asset, amount: b.total });
      } catch { /* skip */ }
    }
    const p = await buildPortfolio(ws!.map((w) => ({ chain: w.chain, address: w.address, label: w.label })), {}, exHoldings);
    if (p.pricedPct < 50 || !p.holdings.length) continue;
    await sb.from("holdings_snapshots").insert({ wallet_id: ws![0]?.id ?? null, user_id: userId, total_usd: p.totalUsd, holdings: p.holdings.map((h) => ({ chain: h.chain, address: h.address, symbol: h.symbol, amount: h.amount, price_usd: h.priceUsd, value_usd: h.valueUsd })) });
    saved++;
  }
  return NextResponse.json({ ok: true, users: byUser.size, saved, at: new Date().toISOString() });
}
