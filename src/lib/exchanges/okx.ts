// OKX read-only account adapter (API v5). Signature: base64(HMAC-SHA256(timestamp + method + path + body, secret)).
// Needs the API key, secret and the passphrase chosen when the key was created.

import { createHmac } from "node:crypto";
import type { ExchangeAdapter, ExchangeBalance, ExchangeCredentials, ExchangeFill } from "./types";
import { normAsset } from "./types";

const BASE = "https://www.okx.com";

async function priv<T>(c: ExchangeCredentials, path: string): Promise<T> {
  if (!c.passphrase) throw new Error("OKX: passphrase required");
  const ts = new Date().toISOString();
  const sig = createHmac("sha256", c.secret).update(ts + "GET" + path).digest("base64");
  const res = await fetch(BASE + path, { headers: { "OK-ACCESS-KEY": c.key, "OK-ACCESS-SIGN": sig, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": c.passphrase, "content-type": "application/json" }, cache: "no-store" });
  const j = (await res.json()) as { code: string; msg: string; data: T };
  if (j.code !== "0") throw new Error(`OKX: ${j.msg || j.code}`);
  return j.data;
}

export const okx: ExchangeAdapter = {
  id: "okx",
  async verify(c) {
    // /account/config reports the key's permission string: "read_only", "trade", "withdraw" (comma separated)
    const cfg = await priv<{ perm?: string }[]>(c, "/api/v5/account/config");
    const perm = (cfg[0]?.perm ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    const perms = perm.length ? perm : ["read_only (assumed)"];
    if (perm.some((p) => p === "trade" || p === "withdraw")) return { ok: false, permissions: perms, warning: "This key can trade or withdraw. Create a new key with 'Read' permission only." };
    return { ok: true, permissions: perms };
  },
  async balances(c) {
    const r = await priv<{ details: { ccy: string; eq: string; availBal: string }[] }[]>(c, "/api/v5/account/balance");
    const out: ExchangeBalance[] = [];
    for (const d of r[0]?.details ?? []) {
      const total = Number(d.eq);
      if (total > 0) out.push({ asset: normAsset(d.ccy), total, available: Number(d.availBal) || 0 });
    }
    // funding account too (spot deposits often sit there)
    try {
      const f = await priv<{ ccy: string; bal: string; availBal: string }[]>(c, "/api/v5/asset/balances");
      for (const d of f) {
        const total = Number(d.bal);
        if (total <= 0) continue;
        const x = out.find((b) => b.asset === normAsset(d.ccy));
        if (x) { x.total += total; x.available += Number(d.availBal) || 0; } else out.push({ asset: normAsset(d.ccy), total, available: Number(d.availBal) || 0 });
      }
    } catch { /* funding endpoint optional */ }
    return out;
  },
  async fills(c, opts) {
    // fills-history covers the last 3 months, 100 per page, paginated with "after" (billId)
    const out: ExchangeFill[] = [];
    let after = "";
    const limit = opts?.limit ?? 500;
    while (out.length < limit) {
      const r = await priv<{ billId: string; instId: string; side: "buy" | "sell"; fillPx: string; fillSz: string; fee: string; feeCcy: string; ts: string }[]>(c, `/api/v5/trade/fills-history?instType=SPOT&limit=100${after ? `&after=${after}` : ""}`);
      if (!r.length) break;
      for (const t of r) {
        const [base, quote] = t.instId.split("-");
        if (!base || !quote) continue;
        const fee = Math.abs(Number(t.fee));
        out.push({ id: t.billId, time: new Date(Number(t.ts)).toISOString(), pair: `${base}/${quote}`, base: normAsset(base), quote: normAsset(quote), side: t.side, price: Number(t.fillPx), amount: Number(t.fillSz), fee: t.feeCcy === quote ? fee : t.feeCcy === base ? fee * Number(t.fillPx) : 0, feeAsset: t.feeCcy });
      }
      after = r[r.length - 1].billId;
      if (r.length < 100) break;
    }
    return out;
  },
};
