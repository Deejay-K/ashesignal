import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { LAB_VARIANTS } from "@/lib/ta/lab";

export const dynamic = "force-dynamic";

export interface VariantAgg { id: string; label: string; group: string; charts: number; filled: number; wins: number; losses: number; expired: number; winRate: number | null; expectancyR: number | null; profitFactor: number | null; byTf: Record<string, { filled: number; winRate: number | null; expectancyR: number | null }> }

/** Aggregates engine_lab rows per variant (pooled trades, so big charts weigh more) and lists the best/worst charts under production rules. */
export async function GET() {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ variants: [], charts: [], note: "Needs the worker (SUPABASE_SERVICE_ROLE_KEY)." });
  const { data } = await sb.from("engine_lab").select("*").limit(5000);
  const rows = data ?? [];
  const variants: VariantAgg[] = LAB_VARIANTS.map((v) => {
    const rs = rows.filter((r) => r.variant === v.id);
    const filled = rs.reduce((s, r) => s + (r.filled ?? 0), 0);
    const wins = rs.reduce((s, r) => s + (r.wins ?? 0), 0);
    const losses = rs.reduce((s, r) => s + (r.losses ?? 0), 0);
    const expired = rs.reduce((s, r) => s + (r.expired ?? 0), 0);
    const expR = filled ? rs.reduce((s, r) => s + (Number(r.expectancy_r ?? 0) * (r.filled ?? 0)), 0) / filled : null;
    const byTf: VariantAgg["byTf"] = {};
    for (const tf of ["1h", "4h", "1d"]) {
      const t = rs.filter((r) => r.timeframe === tf);
      const f = t.reduce((s, r) => s + (r.filled ?? 0), 0);
      const w = t.reduce((s, r) => s + (r.wins ?? 0), 0);
      const l = t.reduce((s, r) => s + (r.losses ?? 0), 0);
      byTf[tf] = { filled: f, winRate: w + l ? Math.round((100 * w) / (w + l)) : null, expectancyR: f ? +(t.reduce((s, r) => s + Number(r.expectancy_r ?? 0) * (r.filled ?? 0), 0) / f).toFixed(2) : null };
    }
    const grossWin = rs.reduce((s, r) => s + (Number(r.profit_factor ?? 0) > 0 && r.losses ? Number(r.profit_factor) * r.losses : 0), 0);
    return { id: v.id, label: v.label, group: v.group, charts: rs.length, filled, wins, losses, expired, winRate: wins + losses ? Math.round((100 * wins) / (wins + losses)) : null, expectancyR: expR == null ? null : +expR.toFixed(2), profitFactor: losses ? +(grossWin / losses).toFixed(2) : null, byTf };
  });
  const prod = rows.filter((r) => r.variant === "production" && (r.filled ?? 0) >= 6).map((r) => ({ assetKey: r.asset_key, symbol: r.symbol, timeframe: r.timeframe, filled: r.filled, winRate: r.win_rate == null ? null : Number(r.win_rate), expectancyR: r.expectancy_r == null ? null : Number(r.expectancy_r), updatedAt: r.updated_at }));
  prod.sort((a, b) => (b.expectancyR ?? -9) - (a.expectancyR ?? -9));
  const updated = rows.reduce((m, r) => Math.max(m, Date.parse(r.updated_at)), 0);
  return NextResponse.json({ variants, best: prod.slice(0, 12), worst: prod.slice(-12).reverse(), coverage: new Set(rows.filter((r) => r.variant === "production").map((r) => `${r.asset_key}|${r.timeframe}`)).size, updatedAt: updated || null });
}
