import { NextRequest, NextResponse } from "next/server";
import { getFearGreed } from "@/lib/providers/feargreed";
import { safe } from "@/lib/fetch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(2000, Number(req.nextUrl.searchParams.get("limit") ?? 365));
  const r = await safe(getFearGreed(limit));
  if (!r.ok) return NextResponse.json({ error: r.error, data: [] }, { status: 502 });
  return NextResponse.json({ data: r.data, source: "alternative.me" });
}
