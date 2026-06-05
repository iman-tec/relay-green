/*
 * Shared post-session routing for /auth/callback (PKCE ?code=…) and
 * /auth/confirm (token_hash). Both routes verify the user, then call
 * this helper to decide whether to send them to /set-password (no
 * password yet) or to their role-aware landing.
 */

import { NextResponse } from "next/server";
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { landingForRoles } from "@/lib/relay/role-labels";

export async function routeAfterAuth(
  supabase: SupabaseClient,
  request: Request
): Promise<NextResponse> {
  const { origin } = new URL(request.url);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth_no_user`);
  }

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const landing = landingForRoles(roles);
  const isCustomerOnly = roles.length > 0 && roles.every((r) => r === "client");
  const mode = isCustomerOnly ? "customer" : "staff";

  // Password recovery (the "Reset password" link from the profile page /
  // forgot-password) must always land on /set-password so the user can pick
  // a new password — even though they already have one. The has-password
  // divert below only fires for brand-new users; recovery needs the same
  // destination unconditionally.
  if (new URL(request.url).searchParams.get("type") === "recovery") {
    const target = new URL("/set-password", request.url);
    target.searchParams.set("mode", mode);
    target.searchParams.set("continue", landing);
    return NextResponse.redirect(target);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    try {
      const admin = createAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: hasPw, error } = await admin.rpc("user_has_password", {
        _user_id: user.id,
      });
      if (error) {
        console.warn(
          "[auth-post-signin] user_has_password RPC error:",
          error.message
        );
      } else if (hasPw === false) {
        const target = new URL("/set-password", request.url);
        target.searchParams.set("mode", mode);
        target.searchParams.set("continue", landing);
        return NextResponse.redirect(target);
      }
    } catch (e) {
      console.warn(
        "[auth-post-signin] has-password admin check failed:",
        e instanceof Error ? e.message : e
      );
    }
  } else {
    console.warn(
      "[auth-post-signin] supabase service-role env missing — skipping has-password check"
    );
  }

  return NextResponse.redirect(new URL(landing, request.url));
}
