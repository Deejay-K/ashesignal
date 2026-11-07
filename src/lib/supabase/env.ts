export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** True when Supabase is configured. The app runs fully in guest mode when it isn't. */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON);
