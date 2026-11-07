import { NextResponse } from "next/server";
import { discover } from "@/lib/market/discover";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await discover());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
