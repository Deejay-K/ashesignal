// Next.js 16 proxy (formerly middleware): refreshes the Supabase session cookie on every request.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON, SUPABASE_ENABLED, SUPABASE_URL } from "@/lib/supabase/env";

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  if (!SUPABASE_ENABLED) return res;
  const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all) => {
        all.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        all.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  await sb.auth.getUser();
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
