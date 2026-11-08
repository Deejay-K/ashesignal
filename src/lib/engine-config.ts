// Live engine configuration: gate thresholds adopted from the Engine Lab, stored in engine_config and
// applied process-wide (cached 5 minutes). Without Supabase the defaults stay in force.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_GATES, setRuntimeGates, type GateOptions } from "@/lib/ta/analysis";

export interface EngineConfigRow { key: string; value: Record<string, unknown>; note: string | null; updated_at: string; updated_by: string | null }

let loadedAt = 0;
let cache: Partial<GateOptions> = {};

/** Load adopted gates once per 5 minutes and push them into the analysis module. Safe to call anywhere server-side. */
export function invalidateEngineConfig() { loadedAt = 0; }

export async function ensureEngineConfig(): Promise<Required<GateOptions>> {
  if (Date.now() - loadedAt < 5 * 60_000) return { ...DEFAULT_GATES, ...cache };
  loadedAt = Date.now();
  const sb = supabaseAdmin();
  if (!sb) return DEFAULT_GATES;
  try {
    const { data } = await sb.from("engine_config").select("value").eq("key", "gates").maybeSingle();
    cache = sanitize(data?.value ?? {});
    setRuntimeGates(cache);
  } catch { /* keep previous */ }
  return { ...DEFAULT_GATES, ...cache };
}

export function sanitize(v: Record<string, unknown>): Partial<GateOptions> {
  const out: Partial<GateOptions> = {};
  const num = (k: keyof GateOptions, lo: number, hi: number) => { const x = Number(v[k]); if (Number.isFinite(x) && x >= lo && x <= hi) out[k] = x; };
  num("band", 10, 90); num("volMin", 0, 3); num("stretchMax", 0.5, 6); num("tp1Min", 0.3, 3); num("tp2Min", 0.5, 5);
  return out;
}

export function isAdminEmail(email?: string | null): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}
