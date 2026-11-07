"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON, SUPABASE_ENABLED, SUPABASE_URL } from "./env";

let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  if (!SUPABASE_ENABLED) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
  return client;
}
