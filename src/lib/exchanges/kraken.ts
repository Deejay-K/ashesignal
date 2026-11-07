import { createHash, createHmac } from "node:crypto";
import type { ExchangeAdapter, ExchangeBalance, ExchangeCredentials, ExchangeFill } from "./types";
import { normAsset } from "./types";

const BASE = "https://api.kraken.com";

async function priv<T>(c: ExchangeCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const uri = `/0/private/${path}`;
  const sha = createHash("sha256").update(nonce + body).digest();
  const sig = createHmac("sha512", Buffer.from(c.secret, "base64")).update(Buffer.concat([Buffer.from(uri), sha])).digest("base64");
  const res = await fetch(BASE + uri, { method: "POST", headers: { "API-Key": c.key, "API-Sign": sig, "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const j = (await res.json()) as { error: string[]; result: T };
  if (j.error?.length) throw new Error(`Kraken: ${j.error.join(", ")}`);
  return j.result;
}

let pairMap: Map<string, { base: string; quote: string; alt: string }> | null = null;
async function pairs() {
  if (pairMap) return pairMap;
  const res = await fetch(`${BASE}/0/public/AssetPairs`, { cache: "no-store" });
  const j = (await res.json()) as { result: Record<string, { base: string; quote: string; altname: string; wsname?: string }> };
  pairMap = new Map();
  for (const [id, p] of Object.entries(j.result)) {
    const ws = p.wsname?.split("/");
    pairMap.set(id, { base: normAsset(ws?.[0] ?? p.base), quote: normAsset(ws?.[1] ?? p.quote), alt: p.altname });
  }
  return pairMap;
}

export const kraken: ExchangeAdapter = {
  id: "kraken",
  async verify(c) {
    await priv(c, "Balance");
    // Kraken exposes no permission endpoint; a withdrawal attempt is never made. We state the requirement instead.
    return { ok: true, permissions: ["query funds (verified)"], warning: "Make sure the key was created with only 'Query Funds' and 'Query Closed Orders & Trades' permissions." };
  },
  async balances(c) {
    const r = await priv<Record<string, string>>(c, "Balance");
    const out: ExchangeBalance[] = [];
    for (const [asset, amt] of Object.entries(r)) {
      const n = Number(amt);
      if (n > 0) out.push({ asset: normAsset(asset), total: n, available: n });
    }
    // merge duplicates (e.g. ETH + ETH.S staked)
    const m = new Map<string, ExchangeBalance>();
    for (const b of out) { const x = m.get(b.asset); if (x) { x.total += b.total; x.available += b.available; } else m.set(b.asset, { ...b }); }
    return [...m.values()];
  },
  async fills(c, opts) {
    const pm = await pairs();
    const out: ExchangeFill[] = [];
    let ofs = 0;
    const limit = opts?.limit ?? 500;
    while (out.length < limit) {
      const r = await priv<{ trades: Record<string, { ordertxid: string; pair: string; time: number; type: "buy" | "sell"; price: string; vol: string; cost: string; fee: string }>; count: number }>(c, "TradesHistory", { ofs: String(ofs) });
      const entries = Object.entries(r.trades ?? {});
      if (!entries.length) break;
      for (const [id, t] of entries) {
        const p = pm.get(t.pair) ?? { base: normAsset(t.pair.slice(0, 4)), quote: normAsset(t.pair.slice(4)), alt: t.pair };
        out.push({ id, time: new Date(t.time * 1000).toISOString(), pair: `${p.base}/${p.quote}`, base: p.base, quote: p.quote, side: t.type, price: Number(t.price), amount: Number(t.vol), fee: Number(t.fee), feeAsset: p.quote });
      }
      ofs += entries.length;
      if (ofs >= r.count) break;
    }
    return out;
  },
};
