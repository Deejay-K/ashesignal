import { NextRequest, NextResponse } from "next/server";
import { ensureEngineConfig } from "@/lib/engine-config";
import { scanAddress } from "@/lib/market/scan";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureEngineConfig();
  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  try {
    return NextResponse.json(await scanAddress(address, ["15m", "1h", "4h"]));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
