import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_GATES } from "@/lib/ta/analysis";
import { ensureEngineConfig, invalidateEngineConfig, isAdminEmail, sanitize } from "@/lib/engine-config";
import { LAB_VARIANTS } from "@/lib/ta/lab";

export const dynamic = "force-dynamic";

/** GET: defaults, live gates, history, whether the caller may change them. */
export async function GET() {
  const live = await ensureEngineConfig();
  const sb = supabaseAdmin();
  const { data: hist } = sb ? await sb.from("engine_config_history").select("*").eq("key", "gates").order("changed_at", { ascending: false }).limit(20) : { data: [] };
  const ss = await supabaseServer();
  const email = ss ? (await ss.auth.getUser()).data.user?.email : null;
  return NextResponse.json({ defaults: DEFAULT_GATES, live, history: hist ?? [], canEdit: isAdminEmail(email), adminConfigured: !!process.env.ADMIN_EMAILS, variants: LAB_VARIANTS.map((v) => ({ id: v.id, label: v.label, gates: v.opts.gates ?? {}, htfFilter: !!v.opts.htfFilter })) });
}

/** POST { gates: {...}, note } (admin) - adopt new thresholds; { reset: true } restores defaults. */
export async function POST(req: NextRequest) {
  const ss = await supabaseServer();
  const email = ss ? (await ss.auth.getUser()).data.user?.email : null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: "Only the deployment owner (ADMIN_EMAILS) can change engine rules." }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  const b = await req.json().catch(() => ({}));
  const value = b.reset ? {} : sanitize(b.gates ?? {});
  const note = b.reset ? "Reset to defaults" : String(b.note ?? "").slice(0, 300);
  await sb.from("engine_config").upsert({ key: "gates", value, note, updated_at: new Date().toISOString(), updated_by: email });
  await sb.from("engine_config_history").insert({ key: "gates", value, note, changed_by: email });
  invalidateEngineConfig();
  await ensureEngineConfig();
  return NextResponse.json({ ok: true, live: { ...DEFAULT_GATES, ...value } });
}
