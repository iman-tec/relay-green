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
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Roles the staff login form can claim. Anything else is ignored.
const CLAIMABLE_ROLES = new Set(["engineer", "pod_lead", "ops_manager", "admin"]);

export async function POST(request: Request) {
  const { email, code, role, mode } = await request.json().catch(() => ({}));
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

  return NextResponse.json({ ok: true, next });
}

// Maps a user's role set to the page they should land on after sign-in.
// Order is significant: admin > ops_manager > pod_lead > engineer > customer.
function landingForRoles(roles: string[]): string {
  if (roles.includes("super_admin"))      return "/admin";
  if (roles.includes("enterprise_admin")) return "/enterprise";
  if (roles.includes("admin"))            return "/admin";
  if (roles.includes("ops_manager"))      return "/admin";
  if (roles.includes("pod_lead"))         return "/supervise";
  if (roles.includes("engineer"))         return "/dashboard";
  return "/room";
}
