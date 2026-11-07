// Coinbase Advanced Trade API with CDP API keys (key name + EC private key), ES256 JWT per request.
import { SignJWT, importPKCS8 } from "jose";
import { randomBytes } from "node:crypto";
import type { ExchangeAdapter, ExchangeBalance, ExchangeCredentials, ExchangeFill } from "./types";
import { normAsset } from "./types";

const HOST = "api.coinbase.com";

async function jwt(c: ExchangeCredentials, method: string, path: string) {
  const pem = c.secret.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem.includes("BEGIN EC PRIVATE KEY") ? await ecToPkcs8(pem) : pem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: "cdp", sub: c.key, nbf: now, exp: now + 120, uri: `${method} ${HOST}${path}` })
    .setProtectedHeader({ alg: "ES256", kid: c.key, nonce: randomBytes(16).toString("hex"), typ: "JWT" })
    .sign(key);
}

// Coinbase downloads keys as "EC PRIVATE KEY" (SEC1). jose needs PKCS#8; convert via node crypto.
async function ecToPkcs8(pem: string) {
  const { createPrivateKey } = await import("node:crypto");
  return createPrivateKey({ key: pem, format: "pem" }).export({ type: "pkcs8", format: "pem" }).toString();
}

async function get<T>(c: ExchangeCredentials, path: string): Promise<T> {
  const token = await jwt(c, "GET", path.split("?")[0]);
  const res = await fetch(`https://${HOST}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const coinbase: ExchangeAdapter = {
  id: "coinbase",
  async verify(c) {
    const r = await get<{ can_view: boolean; can_trade: boolean; can_transfer: boolean }>(c, "/api/v3/brokerage/key_permissions");
    const perms = [r.can_view ? "view" : "", r.can_trade ? "trade" : "", r.can_transfer ? "transfer" : ""].filter(Boolean);
    if (r.can_transfer || r.can_trade) return { ok: false, permissions: perms, warning: "This key can trade or transfer. Create a new key with View permission only." };
    return { ok: true, permissions: perms };
  },
  async balances(c) {
    const out: ExchangeBalance[] = [];
    let cursor = "";
    do {
      const r = await get<{ accounts: { currency: string; available_balance: { value: string }; hold: { value: string } }[]; has_next: boolean; cursor: string }>(c, `/api/v3/brokerage/accounts?limit=250${cursor ? `&cursor=${cursor}` : ""}`);
      for (const a of r.accounts) {
        const avail = Number(a.available_balance.value);
        const hold = Number(a.hold?.value ?? 0);
        if (avail + hold > 0) out.push({ asset: normAsset(a.currency), total: avail + hold, available: avail });
      }
      cursor = r.has_next ? r.cursor : "";
    } while (cursor);
    return out;
  },
  async fills(c, opts) {
    const out: ExchangeFill[] = [];
    let cursor = "";
    const limit = opts?.limit ?? 500;
    do {
      const r = await get<{ fills: { entry_id: string; trade_time: string; product_id: string; side: "BUY" | "SELL"; price: string; size: string; commission: string; size_in_quote: boolean }[]; cursor: string }>(c, `/api/v3/brokerage/orders/historical/fills?limit=250${cursor ? `&cursor=${cursor}` : ""}`);
      for (const f of r.fills) {
        const [base, quote] = f.product_id.split("-");
        const price = Number(f.price);
        const size = f.size_in_quote ? Number(f.size) / price : Number(f.size);
        out.push({ id: f.entry_id, time: f.trade_time, pair: `${base}/${quote}`, base: normAsset(base), quote: normAsset(quote), side: f.side === "BUY" ? "buy" : "sell", price, amount: size, fee: Number(f.commission), feeAsset: normAsset(quote) });
      }
      cursor = r.cursor ?? "";
    } while (cursor && out.length < limit);
    return out;
  },
};
