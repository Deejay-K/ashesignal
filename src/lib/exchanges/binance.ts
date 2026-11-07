import { createHmac } from "node:crypto";
import type { ExchangeAdapter, ExchangeBalance, ExchangeCredentials, ExchangeFill } from "./types";
import { normAsset, STABLES } from "./types";

const HOSTS = [process.env.BINANCE_PRIVATE_BASE_URL, "https://api.binance.com", "https://api.binance.us"].filter((h): h is string => !!h);

async function signed<T>(c: ExchangeCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "10000" }).toString();
  const sig = createHmac("sha256", c.secret).update(q).digest("hex");
  let lastErr: unknown;
  for (const host of HOSTS) {
    const res = await fetch(`${host}${path}?${q}&signature=${sig}`, { headers: { "X-MBX-APIKEY": c.key }, cache: "no-store" });
    if (res.status === 451 || res.status === 403) { lastErr = new Error(`Binance HTTP ${res.status} (geo-blocked from this server)`); continue; }
    const j = (await res.json()) as T & { code?: number; msg?: string };
    if (!res.ok || (j as { code?: number }).code) throw new Error(`Binance: ${(j as { msg?: string }).msg ?? res.status}`);
    return j;
  }
  throw lastErr ?? new Error("Binance unreachable");
}

export const binance: ExchangeAdapter = {
  id: "binance",
  async verify(c) {
    const r = await signed<{ enableWithdrawals: boolean; enableSpotAndMarginTrading: boolean; enableReading: boolean }>(c, "/sapi/v1/account/apiRestrictions");
    const perms = [r.enableReading ? "read" : "", r.enableSpotAndMarginTrading ? "trade" : "", r.enableWithdrawals ? "withdraw" : ""].filter(Boolean);
    if (r.enableWithdrawals || r.enableSpotAndMarginTrading) return { ok: false, permissions: perms, warning: "This key can trade or withdraw. Create a new key with 'Enable Reading' only." };
    return { ok: true, permissions: perms };
  },
  async balances(c) {
    const r = await signed<{ balances: { asset: string; free: string; locked: string }[] }>(c, "/api/v3/account");
    return r.balances.map((b) => ({ asset: normAsset(b.asset), total: Number(b.free) + Number(b.locked), available: Number(b.free) })).filter((b) => b.total > 0);
  },
  async fills(c, opts) {
    // Binance needs a symbol per request: query USDT/USDC pairs for each held non-stable asset.
    const bal = await this.balances(c);
    const symbols = opts?.symbols ?? bal.filter((b) => !STABLES.has(b.asset)).map((b) => b.asset).slice(0, 15);
    const out: ExchangeFill[] = [];
    for (const s of symbols) {
      for (const quote of ["USDT", "USDC"]) {
        try {
          const r = await signed<{ id: number; time: number; price: string; qty: string; commission: string; commissionAsset: string; isBuyer: boolean }[]>(c, "/api/v3/myTrades", { symbol: `${s}${quote}`, limit: "500" });
          for (const t of r) out.push({ id: String(t.id), time: new Date(t.time).toISOString(), pair: `${s}/${quote}`, base: s, quote, side: t.isBuyer ? "buy" : "sell", price: Number(t.price), amount: Number(t.qty), fee: t.commissionAsset === quote ? Number(t.commission) : t.commissionAsset === s ? Number(t.commission) * Number(t.price) : 0, feeAsset: t.commissionAsset });
        } catch { /* pair may not exist */ }
      }
    }
    return out;
  },
};
