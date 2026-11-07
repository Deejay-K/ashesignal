// Worker: scan a rotating set of tokens for large transfers and log them (whale_events).
// Sources: DEX tokens on watchlists / alerts, GeckoTerminal trending base tokens, and a fixed
// set of major ERC-20s. Needs ALCHEMY_API_KEY / HELIUS_API_KEY like the scanner's whale watch.

import type { SupabaseClient } from "@supabase/supabase-js";
import { whaleWatch } from "./whales";
import { getTrendingPools } from "@/lib/providers/geckoterminal";
import { getPairsByToken } from "@/lib/providers/dexscreener";
import { safe } from "@/lib/fetch";

const MAJORS: { chain: string; address: string; symbol: string }[] = [
  { chain: "ethereum", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT" },
  { chain: "ethereum", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC" },
  { chain: "ethereum", address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC" },
  { chain: "ethereum", address: "0x514910771af9ca656af840dff83e8264ecf986ca", symbol: "LINK" },
  { chain: "ethereum", address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", symbol: "UNI" },
  { chain: "ethereum", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", symbol: "PEPE" },
  { chain: "ethereum", address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", symbol: "SHIB" },
];

export async function scanWhales(sb: SupabaseClient, batch: number): Promise<{ scanned: number; logged: number }> {
  const targets: { chain: string; address: string; symbol: string | null; price: number | null }[] = [];
  const [{ data: wl }, { data: al }, tr] = await Promise.all([
    sb.from("watchlist_items").select("chain, address, symbol").not("address", "is", null).limit(100),
    sb.from("alerts").select("asset_ref, symbol").eq("type", "whale_transfer").eq("active", true).limit(100),
    safe(getTrendingPools()),
  ]);
  const seen = new Set<string>();
  const add = (chain: string, address: string, symbol: string | null, price: number | null) => { const k = `${chain}:${address.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); targets.push({ chain, address, symbol, price }); } };
  for (const w of wl ?? []) if (w.chain && w.address) add(w.chain, w.address, w.symbol, null);
  for (const a of al ?? []) { const r = a.asset_ref as { chain?: string; address?: string } | null; if (r?.chain && r.address) add(r.chain, r.address, a.symbol, null); }
  if (tr.ok) for (const p of tr.data.slice(0, 20)) if (p.baseTokenAddress) add(p.network === "eth" ? "ethereum" : p.network, p.baseTokenAddress, p.name.split("/")[0].trim(), p.priceUsd);
  for (const m of MAJORS) add(m.chain, m.address, m.symbol, null);
  // rotate: 6 tokens per batch to stay inside function limits
  const per = 6;
  const slice = targets.slice(batch * per, batch * per + per);
  let logged = 0;
  for (const t of slice) {
    let price = t.price;
    if (price == null) {
      const pairs = await safe(getPairsByToken(t.address));
      price = pairs.ok ? pairs.data[0]?.priceUsd ?? null : null;
    }
    if (!price) continue;
    const w = await safe(whaleWatch(t.chain, t.address, price));
    if (!w.ok || !w.data.available) continue;
    const rows = w.data.transfers.filter((x) => x.valueUsd >= 50_000).map((x) => ({ chain: t.chain, token_address: t.address.toLowerCase(), symbol: t.symbol, tx_hash: x.hash, from_addr: x.from, to_addr: x.to, from_label: x.fromLabel ?? null, to_label: x.toLabel ?? null, kind: x.kind, amount: x.amount, value_usd: x.valueUsd, occurred_at: x.timestamp }));
    if (rows.length) {
      const { error, count } = await sb.from("whale_events").upsert(rows, { onConflict: "chain,tx_hash,token_address,from_addr,to_addr", ignoreDuplicates: true, count: "exact" });
      if (!error) logged += count ?? rows.length;
    }
  }
  await sb.from("whale_events").delete().lt("seen_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  return { scanned: slice.length, logged };
}
