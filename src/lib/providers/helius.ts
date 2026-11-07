// Helius: Solana wallet balances (DAS) and enhanced transaction history. Free tier available.
// https://dashboard.helius.dev

const KEY = () => process.env.HELIUS_API_KEY;
export const HELIUS_ENABLED = () => Boolean(KEY());

export interface SolHolding {
  chain: "solana";
  address: string | null; // mint; null = SOL
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  priceUsd?: number | null; // Helius sometimes includes a price
  logo?: string;
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY()}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!res.ok) throw new Error(`helius HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`helius: ${j.error.message}`);
  return j.result as T;
}

export async function getSolHoldings(wallet: string): Promise<SolHolding[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const r = await post<{ items: any[]; nativeBalance?: { lamports: number; price_per_sol?: number } }>({
    jsonrpc: "2.0",
    id: "1",
    method: "getAssetsByOwner",
    params: { ownerAddress: wallet, page: 1, limit: 200, displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false } },
  });
  const out: SolHolding[] = [];
  const lam = r.nativeBalance?.lamports ?? 0;
  if (lam > 0) out.push({ chain: "solana", address: null, symbol: "SOL", name: "Solana", decimals: 9, amount: lam / 1e9, priceUsd: r.nativeBalance?.price_per_sol ?? null });
  for (const it of r.items ?? []) {
    if (it.interface !== "FungibleToken" && it.interface !== "FungibleAsset") continue;
    const ti = it.token_info ?? {};
    const amount = (ti.balance ?? 0) / 10 ** (ti.decimals ?? 0);
    if (!(amount > 0)) continue;
    out.push({ chain: "solana", address: it.id, symbol: ti.symbol ?? it.content?.metadata?.symbol ?? "?", name: it.content?.metadata?.name ?? ti.symbol ?? "?", decimals: ti.decimals ?? 0, amount, priceUsd: ti.price_info?.price_per_token ?? null, logo: it.content?.links?.image });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return out;
}

export interface SolTransfer {
  hash: string;
  chain: "solana";
  timestamp: string | null;
  type: string;
  description: string;
  direction: "in" | "out" | "other";
  asset: string;
  value: number | null;
}

export async function getSolTransfers(wallet: string, limit = 50): Promise<SolTransfer[]> {
  const res = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${KEY()}&limit=${Math.min(limit, 100)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`helius tx HTTP ${res.status}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const txs = (await res.json()) as any[];
  return txs.map((t) => {
    const nat = (t.nativeTransfers ?? []).find((n: any) => n.fromUserAccount === wallet || n.toUserAccount === wallet);
    const tok = (t.tokenTransfers ?? []).find((n: any) => n.fromUserAccount === wallet || n.toUserAccount === wallet);
    const dir: SolTransfer["direction"] = tok ? (tok.toUserAccount === wallet ? "in" : "out") : nat ? (nat.toUserAccount === wallet ? "in" : "out") : "other";
    return { hash: t.signature, chain: "solana" as const, timestamp: t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null, type: t.type ?? "UNKNOWN", description: t.description ?? "", direction: dir, asset: tok ? (tok.mint?.slice(0, 6) + "…") : "SOL", value: tok ? tok.tokenAmount ?? null : nat ? nat.amount / 1e9 : null };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
