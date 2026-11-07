import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { ADAPTERS, realizedPnl } from "@/lib/exchanges";
import { priceFillsInUsd } from "@/lib/exchanges/pricing";
import { decrypt, encrypt, EXCHANGE_KEYS_ENABLED } from "@/lib/exchanges/crypto";
import type { ExchangeId } from "@/lib/exchanges/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ctx() {
  const sb = await supabaseServer();
  if (!sb) return { sb: null, user: null, res: NextResponse.json({ error: "accounts disabled" }, { status: 501 }) };
  const { data } = await sb.auth.getUser();
  if (!data.user) return { sb, user: null, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { sb, user: data.user, res: null };
}

/** GET: accounts (no secrets) + live balances, fills and realized P&L. ?quick=1 skips fills. */
export async function GET(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  if (!EXCHANGE_KEYS_ENABLED()) return NextResponse.json({ enabled: false, accounts: [], note: "EXCHANGE_KEY_SECRET is not set on the server (SETUP.md step 11)." });
  const { data: rows } = await sb!.from("exchange_accounts").select("*").eq("user_id", user!.id).order("created_at");
  const quick = req.nextUrl.searchParams.get("quick") === "1";
  const accounts = [];
  const allFills = [];
  for (const r of rows ?? []) {
    const ad = ADAPTERS[r.exchange as ExchangeId];
    const creds = { key: decrypt(r.enc_key), secret: decrypt(r.enc_secret), passphrase: r.enc_passphrase ? decrypt(r.enc_passphrase) : undefined };
    let balances: unknown[] = [];
    let fills: unknown[] = [];
    let error: string | null = null;
    try {
      balances = await ad.balances(creds);
      if (!quick) {
        const f = await ad.fills(creds, { limit: 1000 });
        fills = f;
        allFills.push(...f);
      }
      await sb!.from("exchange_accounts").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("id", r.id);
    } catch (e) {
      error = (e as Error).message;
      await sb!.from("exchange_accounts").update({ last_error: error }).eq("id", r.id);
    }
    accounts.push({ id: r.id, exchange: r.exchange, label: r.label, permissions: r.permissions, lastOkAt: r.last_ok_at, error, balances, fills: quick ? undefined : fills });
  }
  let realized = null;
  let unpricedQuotes: string[] = [];
  if (!quick) {
    const priced = await priceFillsInUsd(allFills as never);
    realized = realizedPnl(priced.fills);
    unpricedQuotes = [...new Set([...realized.unpricedQuotes, ...priced.unpriced])];
    realized.unpricedQuotes = unpricedQuotes;
  }
  return NextResponse.json({ enabled: true, accounts, realized });
}

/** POST { exchange, key, secret, passphrase?, label? } - verifies read-only, encrypts, stores. */
export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  if (!EXCHANGE_KEYS_ENABLED()) return NextResponse.json({ error: "EXCHANGE_KEY_SECRET is not set on the server." }, { status: 501 });
  const b = await req.json().catch(() => null);
  const exchange = b?.exchange as ExchangeId;
  if (!ADAPTERS[exchange]) return NextResponse.json({ error: "exchange is required" }, { status: 400 });
  let key = String(b.key ?? "").trim();
  let secret = String(b.secret ?? "").trim();
  // Coinbase: allow pasting the whole downloaded JSON ({"name": "...", "privateKey": "..."} or {"id","privateKey"}) into either field
  for (const candidate of [key, secret]) {
    if (candidate.startsWith("{")) {
      try {
        const j = JSON.parse(candidate) as Record<string, string>;
        key = j.name ?? j.id ?? j.apiKeyName ?? key;
        secret = j.privateKey ?? j.secret ?? secret;
      } catch { /* not JSON */ }
    }
  }
  if (exchange === "coinbase" && key && !key.includes("/") && b.orgId) key = `organizations/${String(b.orgId).trim()}/apiKeys/${key}`;
  if (!key || !secret) return NextResponse.json({ error: "key and secret are required" }, { status: 400 });
  const creds = { key, secret, passphrase: b.passphrase ? String(b.passphrase) : undefined };
  let v;
  try {
    v = await ADAPTERS[exchange].verify(creds);
  } catch (e) {
    return NextResponse.json({ error: `Key check failed: ${(e as Error).message}` }, { status: 400 });
  }
  if (!v.ok) return NextResponse.json({ error: v.warning ?? "Key has more than read permissions." }, { status: 400 });
  const { error } = await sb!.from("exchange_accounts").insert({ user_id: user!.id, exchange, label: b.label || null, enc_key: encrypt(creds.key), enc_secret: encrypt(creds.secret), enc_passphrase: creds.passphrase ? encrypt(creds.passphrase) : null, permissions: v.permissions, last_ok_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, warning: v.warning ?? null });
}

export async function DELETE(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await sb!.from("exchange_accounts").delete().eq("id", id).eq("user_id", user!.id);
  return NextResponse.json({ ok: true });
}
