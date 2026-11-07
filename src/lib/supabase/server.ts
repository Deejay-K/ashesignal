import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON, SUPABASE_ENABLED, SUPABASE_URL } from "./env";

export async function supabaseServer() {
  if (!SUPABASE_ENABLED) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          all.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component — middleware refreshes the session instead */
        }
      },
    },
  });
}

/** Returns the signed-in user or null (also null when Supabase is not configured). */
export async function currentUser() {
  const sb = await supabaseServer();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
