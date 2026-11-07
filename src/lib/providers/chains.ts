// Chain registry + address classification for the scanner.

import type { ChainInfo } from "@/lib/types";

export const CHAINS: ChainInfo[] = [
  { id: "ethereum", name: "Ethereum", family: "evm", goplusChainId: "1", explorer: "https://etherscan.io/token/" },
  { id: "bsc", name: "BNB Chain", family: "evm", goplusChainId: "56", explorer: "https://bscscan.com/token/" },
  { id: "base", name: "Base", family: "evm", goplusChainId: "8453", explorer: "https://basescan.org/token/" },
  { id: "polygon", name: "Polygon", family: "evm", goplusChainId: "137", explorer: "https://polygonscan.com/token/" },
  { id: "arbitrum", name: "Arbitrum", family: "evm", goplusChainId: "42161", explorer: "https://arbiscan.io/token/" },
  { id: "avalanche", name: "Avalanche", family: "evm", goplusChainId: "43114", explorer: "https://snowtrace.io/token/" },
  { id: "optimism", name: "Optimism", family: "evm", goplusChainId: "10", explorer: "https://optimistic.etherscan.io/token/" },
  { id: "solana", name: "Solana", family: "solana", explorer: "https://solscan.io/token/" },
  { id: "sui", name: "Sui", family: "other" },
  { id: "ton", name: "TON", family: "other" },
];

export const chainById = (id: string) => CHAINS.find((c) => c.id === id);

/** GeckoTerminal network ids differ slightly from DexScreener chain ids. */
export const GECKOTERMINAL_NETWORK: Record<string, string> = {
  ethereum: "eth",
  bsc: "bsc",
  base: "base",
  polygon: "polygon_pos",
  arbitrum: "arbitrum",
  avalanche: "avax",
  optimism: "optimism",
  solana: "solana",
  sui: "sui-network",
  ton: "ton",
};

export type AddressFamily = "evm" | "solana" | "unknown";

/** Best-effort classification of a pasted address string. */
export function classifyAddress(raw: string): AddressFamily {
  const a = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm";
  // Solana: base58, 32-44 chars, no 0 O I l
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return "unknown";
}
