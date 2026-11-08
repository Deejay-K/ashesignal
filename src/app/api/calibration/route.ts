import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export interface CalBucket { band: string; lo: number; hi: number; n: number; tp1: number; tp2: number; sl: number; hitRate: number | null }
export interface Calibration { buckets: CalBucket[]; byKind: Record<string, CalBucket[]>; total: number; updatedAt: number }

let memo: { at: number; value: Calibration } | null = null;
const BANDS: [string, number, number][] = [["<50", 0, 50], ["50-59", 50, 60], ["60-69", 60, 70], ["70-79", 70, 80], ["80+", 80, 101]];

/** Confidence calibration: for each confidence band, how often resolved signals reached TP1 before the stop. */
export async function GET() {
  if (memo && Date.now() - memo.at < 10 * 60_000) return NextResponse.json(memo.value);
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ buckets: [], byKind: {}, total: 0, updatedAt: null });
  const { data } = await sb.from("signal_log").select("confidence, kind, outcome").not("outcome", "is", null).neq("outcome", "expired").gte("emitted_at", new Date(Date.now() - 120 * 86_400_000).toISOString()).limit(20000);
  const rows = (data ?? []).filter((r) => r.confidence != null);
  const build = (rs: typeof rows): CalBucket[] => BANDS.map(([band, lo, hi]) => {
    const b = rs.filter((r) => Number(r.confidence) >= lo && Number(r.confidence) < hi);
    const tp1 = b.filter((r) => String(r.outcome).startsWith("tp")).length;
    const tp2 = b.filter((r) => r.outcome === "tp2" || r.outcome === "tp3").length;
    const sl = b.filter((r) => r.outcome === "sl").length;
    return { band, lo, hi, n: b.length, tp1, tp2, sl, hitRate: b.length >= 5 ? Math.round((100 * tp1) / b.length) : null };
  });
  const value: Calibration = { buckets: build(rows), byKind: { confirmed: build(rows.filter((r) => r.kind === "confirmed")), speculative: build(rows.filter((r) => r.kind === "speculative")) }, total: rows.length, updatedAt: Date.now() };
  memo = { at: Date.now(), value };
  return NextResponse.json(value);
}
