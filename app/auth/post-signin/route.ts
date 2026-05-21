/*
 * Post sign-in router.
 *
 * After a Supabase magic-link / invite redeem, the user lands on
 * /auth/callback which sets the session cookie then forwards here.
 *
 * Two things happen:
 *   1. Look up the user's roles and compute their role-aware landing.
 *   2. If the user hasn't set a password yet (typical for invited
 *      staff: the invite link is single-use, so we collect a password
 *      now so they can sign in normally next time), divert them to
 *      /set-password with the landing as ?continue=. Otherwise send
 *      them straight to the landing.
 */

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
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
  const landing = landingForRoles(roles);
  // Customers landing here came in via an invite link (the /login OTP
  // flow short-circuits to /set-password directly inside verify-otp);
  // for them mode=customer keeps the eventual landing on /room.
  const isCustomerOnly = roles.length > 0 && roles.every((r) => r === "client");
  const mode = isCustomerOnly ? "customer" : "staff";

  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    try {
      const admin = createAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: hasPw, error } = await admin.rpc(
        "user_has_password",
        { _user_id: user.id },
      );
      if (error) {
        console.warn("[post-signin] user_has_password RPC error:", error.message);
      } else if (hasPw === false) {
        const target = new URL("/set-password", request.url);
        target.searchParams.set("mode", mode);
        target.searchParams.set("continue", landing);
        return NextResponse.redirect(target);
      }
    } catch (e) {
      console.warn(
        "[post-signin] has-password admin check failed:",
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    console.warn("[post-signin] supabase service-role env missing — skipping has-password check");
  }

  return NextResponse.redirect(new URL(landing, request.url));
}
