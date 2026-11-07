// Bybit read-only account adapter (API v5, unified account).
// Signature: hex(HMAC-SHA256(timestamp + apiKey + recvWindow + queryString, secret)).

import { createHmac } from "node:crypto";
import type { ExchangeAdapter, ExchangeBalance, ExchangeCredentials, ExchangeFill } from "./types";
import { normAsset } from "./types";

const BASE = "https://api.bybit.com";
const RECV = "10000";

async function priv<T>(c: ExchangeCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const ts = String(Date.now());
  const q = new URLSearchParams(params).toString();
  const sig = createHmac("sha256", c.secret).update(ts + c.key + RECV + q).digest("hex");
  const res = await fetch(`${BASE}${path}${q ? `?${q}` : ""}`, { headers: { "X-BAPI-API-KEY": c.key, "X-BAPI-SIGN": sig, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": RECV }, cache: "no-store" });
  const j = (await res.json()) as { retCode: number; retMsg: string; result: T };
  if (j.retCode !== 0) throw new Error(`Bybit: ${j.retMsg || j.retCode}`);
  return j.result;
}

export const bybit: ExchangeAdapter = {
  id: "bybit",
  async verify(c) {
    const r = await priv<{ readOnly: number; permissions: Record<string, string[]> }>(c, "/v5/user/query-api");
    const flat = Object.entries(r.permissions ?? {}).flatMap(([k, v]) => (v ?? []).map((x) => `${k}:${x}`));
    const canTrade = r.readOnly === 0 && flat.some((p) => /Trade|Order/i.test(p));
    const canWithdraw = flat.some((p) => /Withdraw/i.test(p));
    const perms = [r.readOnly === 1 ? "read-only" : "read-write", ...flat.slice(0, 8)];
    if (canTrade || canWithdraw) return { ok: false, permissions: perms, warning: "This key can trade or withdraw. Create a new key as 'Read-Only' with no withdrawal permission." };
    return { ok: true, permissions: perms };
  },
  async balances(c) {
    const out = new Map<string, ExchangeBalance>();
    const add = (asset: string, total: number, available: number) => { if (total <= 0) return; const a = normAsset(asset); const x = out.get(a); if (x) { x.total += total; x.available += available; } else out.set(a, { asset: a, total, available }); };
    for (const accountType of ["UNIFIED", "FUND"]) {
      try {
        if (accountType === "UNIFIED") {
          const r = await priv<{ list: { coin: { coin: string; walletBalance: string; availableToWithdraw?: string; equity?: string }[] }[] }>(c, "/v5/account/wallet-balance", { accountType });
          for (const acc of r.list ?? []) for (const x of acc.coin ?? []) add(x.coin, Number(x.walletBalance), Number(x.availableToWithdraw ?? x.walletBalance));
        } else {
          const r = await priv<{ balance: { coin: string; walletBalance: string; transferBalance: string }[] }>(c, "/v5/asset/transfer/query-account-coins-balance", { accountType });
          for (const x of r.balance ?? []) add(x.coin, Number(x.walletBalance), Number(x.transferBalance));
        }
      } catch { /* account type may not exist on this account */ }
    }
    return [...out.values()];
  },
  async fills(c, opts) {
    // execution list: last 2 years, 100 per page, cursor paginated
    const out: ExchangeFill[] = [];
    let cursor = "";
    const limit = opts?.limit ?? 500;
    while (out.length < limit) {
      const r = await priv<{ list: { execId: string; symbol: string; side: "Buy" | "Sell"; execPrice: string; execQty: string; execFee: string; feeCurrency?: string; execTime: string }[]; nextPageCursor: string }>(c, "/v5/execution/list", { category: "spot", limit: "100", ...(cursor ? { cursor } : {}) });
      for (const t of r.list ?? []) {
        const quote = ["USDT", "USDC", "USDE", "BTC", "ETH", "EUR"].find((q) => t.symbol.endsWith(q)) ?? "USDT";
        const base = t.symbol.slice(0, -quote.length);
        const fee = Math.abs(Number(t.execFee));
        const feeCcy = t.feeCurrency ?? (t.side === "Buy" ? base : quote);
        out.push({ id: t.execId, time: new Date(Number(t.execTime)).toISOString(), pair: `${base}/${quote}`, base: normAsset(base), quote: normAsset(quote), side: t.side === "Buy" ? "buy" : "sell", price: Number(t.execPrice), amount: Number(t.execQty), fee: feeCcy === quote ? fee : feeCcy === base ? fee * Number(t.execPrice) : 0, feeAsset: feeCcy });
      }
      if (!r.nextPageCursor || !(r.list ?? []).length) break;
      cursor = r.nextPageCursor;
    }
    return out;
  },
};
