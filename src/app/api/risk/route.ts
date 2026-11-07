import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sizePosition } from "@/lib/risk/position";

const schema = z.object({
  tradingBalance: z.number().positive(),
  portfolioValue: z.number().positive().optional(),
  riskPct: z.number().min(0.01).max(100),
  maxLossUsd: z.number().positive().optional(),
  maxExposurePct: z.number().min(1).max(100).optional(),
  leverage: z.number().min(1).max(125).optional(),
  side: z.enum(["LONG", "SHORT"]),
  entry: z.number().positive(),
  stop: z.number().positive(),
  takeProfits: z.array(z.number().positive()).max(6),
  feePct: z.number().min(0).max(5).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json(sizePosition(parsed.data));
}
