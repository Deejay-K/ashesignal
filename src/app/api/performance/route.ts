import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Public engine hit-rate stats from signal_log, grouped by timeframe, kind and side. */
export async function GET() {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured", groups: [] }, { status: 501 });
  const { data, error } = await sb.from("signal_log").select("timeframe, kind, side, outcome, outcome_at, max_favorable_pct, max_adverse_pct, emitted_at, symbol, entry, tp1, sl1").order("emitted_at", { ascending: false }).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const groupBy = (keyFn: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { key: string; total: number; open: number; tp1: number; tp2: number; tp3: number; sl: number; expired: number; avgMfe: number; avgMae: number }>();
    for (const r of rows) {
      const k = keyFn(r);
      const g = m.get(k) ?? { key: k, total: 0, open: 0, tp1: 0, tp2: 0, tp3: 0, sl: 0, expired: 0, avgMfe: 0, avgMae: 0 };
      g.total++;
      const o = r.outcome_at ? r.outcome : r.outcome ?? "open";
      if (!r.outcome_at && !r.outcome) g.open++;
      else if (o === "tp1") g.tp1++;
      else if (o === "tp2") g.tp2++;
      else if (o === "tp3") g.tp3++;
      else if (o === "sl") g.sl++;
      else if (o === "expired") g.expired++;
      g.avgMfe += r.max_favorable_pct ?? 0;
      g.avgMae += r.max_adverse_pct ?? 0;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, avgMfe: +(g.avgMfe / g.total).toFixed(2), avgMae: +(g.avgMae / g.total).toFixed(2), winRate: g.total - g.open ? Math.round(((g.tp1 + g.tp2 + g.tp3) / (g.total - g.open)) * 100) : null }));
  };
  return NextResponse.json({
    total: rows.length,
    byTimeframe: groupBy((r) => r.timeframe),
    byKind: groupBy((r) => r.kind),
    bySide: groupBy((r) => r.side),
    recent: rows.slice(0, 50),
  });
}
