import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { classifyAddress } from "@/lib/providers/chains";
import { ALCHEMY_NETWORKS } from "@/lib/providers/alchemy";

export const dynamic = "force-dynamic";

async function ctx() {
  const sb = await supabaseServer();
  if (!sb)
    return {
      sb: null,
      user: null,
      res: NextResponse.json({ error: "accounts disabled" }, { status: 501 }),
    };
  const { data } = await sb.auth.getUser();
  if (!data.user)
    return {
      sb,
      user: null,
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  return { sb, user: data.user, res: null };
}

export async function GET() {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const { data } = await sb!
    .from("wallets")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at");
  return NextResponse.json({
    wallets: data ?? [],
    chains: ["solana", ...Object.keys(ALCHEMY_NETWORKS)],
  });
}

/** Add a wallet: { chain, address, label? }. Addresses only - never keys or seed phrases. */
export async function POST(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const b = await req.json().catch(() => null);
  const address = String(b?.address ?? "").trim();
  const chain = String(b?.chain ?? "");
  const fam = classifyAddress(address);
  if (fam === "unknown")
    return NextResponse.json(
      {
        error:
          "Address format not recognised (expected 0x… or a Solana address).",
      },
      { status: 400 },
    );
  if (fam === "solana" && chain !== "solana")
    return NextResponse.json(
      { error: "That is a Solana address - pick chain 'solana'." },
      { status: 400 },
    );
  if (fam === "evm" && !ALCHEMY_NETWORKS[chain])
    return NextResponse.json(
      { error: "That is an EVM address - pick an EVM chain." },
      { status: 400 },
    );
  if (
    /\b(seed|mnemonic|private)\b/i.test(address) ||
    address.split(/\s+/).length >= 12
  )
    return NextResponse.json(
      {
        error:
          "Never paste a seed phrase or private key. Only the public address.",
      },
      { status: 400 },
    );
  const { error } = await sb!
    .from("wallets")
    .insert({
      user_id: user!.id,
      chain,
      address: fam === "evm" ? address.toLowerCase() : address,
      label: b?.label || null,
    });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { sb, user, res } = await ctx();
  if (res) return res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await sb!.from("wallets").delete().eq("id", id).eq("user_id", user!.id);
  return NextResponse.json({ ok: true });
}
