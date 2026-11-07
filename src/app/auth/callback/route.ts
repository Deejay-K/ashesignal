import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Handles both Supabase auth flows:
 * - PKCE:        /auth/callback?code=…
 * - token hash:  /auth/callback?token_hash=…&type=magiclink  (email template "Confirm your signin")
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const next = sp.get("next") ?? "/account";
  const sb = await supabaseServer();
  if (!sb) return NextResponse.redirect(new URL("/login?error=accounts-disabled", req.url));
  const code = sp.get("code");
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type");
  let error: string | null = null;
  if (code) error = (await sb.auth.exchangeCodeForSession(code)).error?.message ?? null;
  else if (tokenHash && type) error = (await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as "magiclink" | "email" | "recovery" | "signup" })).error?.message ?? null;
  else error = "missing code";
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url));
  return NextResponse.redirect(new URL(next, req.url));
}
