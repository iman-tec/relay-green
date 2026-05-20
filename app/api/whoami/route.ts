/*
 * GET /api/whoami
 *
 * Dev diagnostic: returns the identity + roles + org id the server sees
 * for the cookie-bearing caller. Hit it from a browser tab after signing
 * in to confirm role resolution. Returns 401 if no session.
 *
 * Strip in production if you don't want this exposed.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  }
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from("user_role_names").select("role").eq("user_id", user.id),
    supabase
      .from("profiles_with_role")
      .select("organization_id, primary_role, full_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email },
    profile,
    roles: (roleRows ?? []).map((r: { role: string }) => r.role),
  });
}
