import { NextResponse } from "next/server";
import { marketRegime } from "@/lib/market/regime";

export const dynamic = "force-dynamic";
export async function GET() {
  try { const r = await marketRegime(); return NextResponse.json(r ?? { error: "unavailable" }, { status: r ? 200 : 503 }); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
