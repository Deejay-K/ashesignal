// Service-role client for cron workers. Bypasses RLS - server only, never imported by client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) return null;
  if (!admin) admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Cron endpoints accept either Vercel's cron header or ?secret= / Authorization: Bearer <CRON_SECRET>. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // open in dev, locked in prod
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  return url.searchParams.get("secret") === secret || auth === `Bearer ${secret}`;
}
