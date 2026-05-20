/*
 * Server-side OTP verify.
 *
 * Verifies the 8-digit code, exchanges it for a Supabase session, and writes
 * the auth cookies onto the response so the next page load is authed.
 * Mirrors the browser-side `verifyOtp` call but runs in Node so it works on
 * networks that block direct browser-to-Supabase traffic.
 *
 * Input  : { email, code }
 * Output : { ok: true } on success; { error } on failure.
 */

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Roles the staff login form can claim. Anything else is ignored.
const CLAIMABLE_ROLES = new Set(["engineer", "pod_lead", "ops_manager", "admin"]);

export async function POST(request: Request) {
  const { email, code, role, mode, purpose } = await request.json().catch(() => ({}));
  if (
    !email || typeof email !== "string" ||
    !code  || typeof code  !== "string"
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const requestedRole =
    typeof role === "string" && CLAIMABLE_ROLES.has(role) ? role : null;
  // `mode` lets the form tell us which experience the user is signing into.
  // The customer login is always for /room — even if the same email also
  // holds the engineer role. Without this, a power-user with both roles
  // (e.g. dev.soni testing both sides) would always land on /dashboard
  // because role-based routing picks the most-privileged role.
  const signInMode: "customer" | "staff" =
    mode === "customer" ? "customer" : "staff";
  // `purpose` tells us why the user is in the OTP flow:
  //   "first-time" → brand-new signup, divert to /set-password.
  //   "forgot"     → forgotten password, force divert regardless of flag.
  //   undefined    → ordinary OTP sign-in; respect the password_set flag.
  const purposeIntent: "first-time" | "forgot" | "signin" =
    purpose === "first-time" ? "first-time" :
    purpose === "forgot"     ? "forgot"     :
                               "signin";

  const supabase = await createClient();

  // Hard-reset any session that might already be in the cookie jar (e.g. from
  // the staff dev quick-pick or a previous user on this browser). Without
  // this, the verify call below sometimes resolves to the *existing* user
  // instead of the one whose OTP we just verified. `scope: "local"` only
  // clears cookies — no round-trip to Supabase.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data: verified, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type:  "email",
  });

  if (error) {
    // Pass Supabase's message through verbatim so the UI can surface it
    // ("Invalid token", "Token has expired", etc.).
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // If the caller asked to sign in *as* a specific staff role (e.g. someone
  // signing in as an engineer for the first time), grant it now. The
  // dev_grant_my_role RPC is SECURITY DEFINER and idempotent — it also
  // bootstraps the profile row when missing.
  if (requestedRole) {
    const { error: grantErr } = await supabase.rpc("dev_grant_my_role", { _role: requestedRole });
    if (grantErr) {
      // Don't fail sign-in if the grant blew up — surface it so we can see
      // it in the logs, but the user is still authed.
      console.warn("[verify-otp] dev_grant_my_role failed:", grantErr.message);
    }
  }

  // Customer-mode sign-ins always go to /room. Staff-mode sign-ins resolve
  // by the user's most-privileged role.
  const userId = verified.user?.id;
  let next = "/room";
  if (signInMode === "staff" && userId) {
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    next = landingForRoles(roles);
  }

  // First-time signup / password-less account / forgot-password: divert
  // to /set-password before the role landing.
  //
  // - purpose === "forgot": always divert. Even if the user already has a
  //   password_set flag, the whole point of the forgot-password flow is to
  //   replace it.
  // - purpose === "first-time" or undefined: divert only when the
  //   password_set flag is false. We use the service-role admin client to
  //   call user_has_password(uuid) explicitly — calling auth.uid() through
  //   the cookie-bound client right after verifyOtp sometimes returns
  //   NULL because the new JWT hasn't propagated, so we bypass that with
  //   an explicit user_id.
  if (userId) {
    if (purposeIntent === "forgot") {
      next = `/set-password?mode=${signInMode}&continue=${encodeURIComponent(next)}&reset=1`;
    } else {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        try {
          const admin = createAdminClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: hasPw, error: hasPwErr } = await admin.rpc(
            "user_has_password",
            { _user_id: userId },
          );
          if (hasPwErr) {
            console.warn("[verify-otp] user_has_password RPC error:", hasPwErr.message);
          } else if (hasPw === false) {
            next = `/set-password?mode=${signInMode}&continue=${encodeURIComponent(next)}`;
          }
        } catch (e) {
          console.warn("[verify-otp] has-password admin check failed:", e instanceof Error ? e.message : e);
        }
      } else {
        console.warn("[verify-otp] supabase service-role env missing — skipping has-password check");
      }
    }
  }

  return NextResponse.json({ ok: true, next });
}
