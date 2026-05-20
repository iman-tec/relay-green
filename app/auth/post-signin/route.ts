/*
 * Post sign-in router.
 *
 * After a Supabase magic-link / invite redeem, the user lands on
 * /auth/callback which sets the session cookie then forwards here. We
 * look up the user's roles and redirect them to the right landing page.
 *
 * Used as the `next` param in invite emails so role-based routing
 * happens after the auth handshake, not before.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  return NextResponse.redirect(new URL(landingForRoles(roles), request.url));
}
