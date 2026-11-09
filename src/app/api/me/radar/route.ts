import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildRadar } from "@/lib/radar";
import { venueFromRequest } from "@/lib/venue-pref";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = sb ? await sb.auth.getUser() : null;
  if (!sb || !auth?.data.user) return NextResponse.json({ error: "sign in" }, { status: 401 });
  return NextResponse.json(await buildRadar(sb, auth.data.user.id, venueFromRequest(req)));
}
