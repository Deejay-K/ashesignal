// Large-transfer ("whale") watch for a token: recent transfers above a USD threshold.
// EVM via Alchemy asset transfers (needs ALCHEMY_API_KEY), Solana via Helius (HELIUS_API_KEY).
// Exchange-wallet labelling is heuristic (a small list of well-known hot wallets).

import { ALCHEMY_ENABLED, ALCHEMY_NETWORKS } from "@/lib/providers/alchemy";
import { HELIUS_ENABLED } from "@/lib/providers/helius";

export interface WhaleTransfer {
  hash: string;
  timestamp: string | null;
  from: string;
  to: string;
  amount: number;
  valueUsd: number;
  fromLabel?: string;
  toLabel?: string;
  kind: "exchange_in" | "exchange_out" | "wallet_to_wallet";
}

export interface WhaleReport {
  available: boolean;
  note: string;
  thresholdUsd: number;
  transfers: WhaleTransfer[];
  summary: { count: number; inflowUsd: number; outflowUsd: number; netToExchangesUsd: number; largestUsd: number };
}

const KNOWN: Record<string, string> = {
  // a few widely known hot wallets; extend over time
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance", "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance", "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance", "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance", "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase", "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase", "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase", "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken", "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken", "0xe853c56864a2ebe4576a807d26fdc4a0ada51919": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX", "0x98ec059dc3adfbdd63429454aeb0c990fba4a128": "OKX",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance", "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Coinbase", "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": "Kraken", "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": "Bybit",
};
const label = (a: string) => KNOWN[a?.toLowerCase?.() ?? a] ?? KNOWN[a];

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function whaleWatch(chain: string, tokenAddress: string, priceUsd: number | null, decimals?: number): Promise<WhaleReport> {
  const empty = (note: string, available = false): WhaleReport => ({ available, note, thresholdUsd: 0, transfers: [], summary: { count: 0, inflowUsd: 0, outflowUsd: 0, netToExchangesUsd: 0, largestUsd: 0 } });
  if (!priceUsd) return empty("No USD price — cannot size transfers.");
  let transfers: WhaleTransfer[] = [];
  if (ALCHEMY_NETWORKS[chain]) {
    if (!ALCHEMY_ENABLED()) return empty("ALCHEMY_API_KEY not set — EVM whale watch disabled.");
    const net = ALCHEMY_NETWORKS[chain];
    const res = await fetch(`https://${net.sub}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [{ fromBlock: "0x0", toBlock: "latest", contractAddresses: [tokenAddress], category: ["erc20"], withMetadata: true, excludeZeroValue: true, maxCount: "0x3e8", order: "desc" }] }), cache: "no-store" });
    if (!res.ok) return empty(`Alchemy HTTP ${res.status}`);
    const j = (await res.json()) as { result?: { transfers: any[] }; error?: { message: string } };
    if (j.error) return empty(`Alchemy: ${j.error.message}`);
    transfers = (j.result?.transfers ?? []).map((t) => ({ hash: t.hash, timestamp: t.metadata?.blockTimestamp ?? null, from: t.from, to: t.to, amount: t.value ?? 0, valueUsd: (t.value ?? 0) * priceUsd, kind: "wallet_to_wallet" as const }));
  } else if (chain === "solana") {
    if (!HELIUS_ENABLED()) return empty("HELIUS_API_KEY not set — Solana whale watch disabled.");
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${tokenAddress}/transactions?api-key=${process.env.HELIUS_API_KEY}&limit=100&type=TRANSFER`, { cache: "no-store" });
    if (!res.ok) return empty(`Helius HTTP ${res.status}`);
    const txs = (await res.json()) as any[];
    const dec = decimals ?? 6;
    for (const t of txs) {
      for (const tt of t.tokenTransfers ?? []) {
        if (tt.mint !== tokenAddress) continue;
        const amount = tt.tokenAmount ?? (tt.rawTokenAmount ? Number(tt.rawTokenAmount.tokenAmount) / 10 ** (tt.rawTokenAmount.decimals ?? dec) : 0);
        transfers.push({ hash: t.signature, timestamp: t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null, from: tt.fromUserAccount ?? "?", to: tt.toUserAccount ?? "?", amount, valueUsd: amount * priceUsd, kind: "wallet_to_wallet" });
      }
    }
  } else return empty(`No transfer indexer for ${chain}.`);

  // threshold: max($10k, 0.5% of 24h value moved) — adaptive so small tokens still surface their biggest moves
  const total = transfers.reduce((s, t) => s + t.valueUsd, 0);
  const thresholdUsd = Math.max(10_000, total * 0.005);
  const big = transfers.filter((t) => t.valueUsd >= thresholdUsd).slice(0, 40);
  for (const t of big) {
    t.fromLabel = label(t.from);
    t.toLabel = label(t.to);
    t.kind = t.toLabel ? "exchange_in" : t.fromLabel ? "exchange_out" : "wallet_to_wallet";
  }
  const inflow = big.filter((t) => t.kind === "exchange_in").reduce((s, t) => s + t.valueUsd, 0);
  const outflow = big.filter((t) => t.kind === "exchange_out").reduce((s, t) => s + t.valueUsd, 0);
  const note = big.length
    ? `${big.length} transfers ≥ ${fmt(thresholdUsd)} in the last ~${transfers.length} transfers. ${inflow > outflow * 1.5 && inflow > 50_000 ? "Net flow INTO exchanges — potential sell pressure." : outflow > inflow * 1.5 && outflow > 50_000 ? "Net flow OUT of exchanges — accumulation / cold storage." : "No decisive exchange flow."}`
    : `No transfers above ${fmt(thresholdUsd)} in the last ${transfers.length} transfers.`;
  return { available: true, note, thresholdUsd, transfers: big, summary: { count: big.length, inflowUsd: inflow, outflowUsd: outflow, netToExchangesUsd: inflow - outflow, largestUsd: big.length ? Math.max(...big.map((t) => t.valueUsd)) : 0 } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const fmt = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
