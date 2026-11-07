import { NextResponse } from "next/server";
import { getGlobal } from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/feargreed";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";

export async function GET() {
  const [g, f] = await Promise.all([safe(getGlobal()), safe(getFearGreed(2))]);
  return NextResponse.json({
    overview: g.ok ? g.data : null,
    overviewError: g.ok ? null : g.error,
    fng: f.ok ? f.data[f.data.length - 1] : null,
    fngPrev: f.ok ? f.data[f.data.length - 2] ?? null : null,
    fngError: f.ok ? null : f.error,
  });
}
