/*
 * POST /api/auth/signin-password
 *
 * Server-side password sign-in with the spec's "second factor" code check.
 *
 * The role taxonomy reshape introduced a per-role code matrix (resellers,
 * inorganic enterprise admins, dept admins, employees each need a parent's
 * code). The DB RPCs login_required_code / verify_login_code know who
 * needs what; this route is the gate that enforces it after password auth.
 *
 * Flow:
 *   1. Validate password via signInWithPassword. On failure → 400.
 *   2. Look up login_required_code(user_id).
 *      • No row              → user is exempt (reseller, organic ent admin,
 *                              regular customer, platform staff). Finalize
 *                              the session and return next.
 *      • Row, but no code in
 *        the request body    → sign back out, return
 *                              { requires_code: true, code_kind }
 *                              so the form can prompt.
 *      • Row, code supplied  → verify_login_code(user_id, code).
 *          true  → finalize the session, return next.
 *          false → sign back out, return
 *                  { error: "invalid_code", requires_code: true, code_kind }.
 *
 * Input:  { email, password, code?, mode?: "customer" | "staff" }
 * Output: { ok: true, next }
 *       | { ok: false, requires_code: true, code_kind, error? }
 *       | { error }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const { email, password, code, mode } = (await request.json().catch(() => ({}))) as {
    email?:    string;
    password?: string;
    code?:     string;
    mode?:     string;
  };
  if (
    !email    || typeof email    !== "string" ||
    !password || typeof password !== "string"
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const signInMode: "customer" | "staff" =
    mode === "customer" ? "customer" : "staff";

  const supabase = await createClient();

  // Clear any stale cookie session before the new sign-in (same defence
  // the OTP path uses — keeps a previous-user's session from colliding
  // with the new one if the staff dev-quick-pick or a logout was racy).
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data, error } = await supabase.auth.signInWithPassword({
    email:    email.trim().toLowerCase(),
    password,
  });
  if (error) {
    // Pass Supabase's text through ("Invalid login credentials", etc.).
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userId = data.user?.id;
  if (!userId) {
    // Defensive — signInWithPassword should never succeed without a user.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ error: "sign_in_unexpected_state" }, { status: 500 });
  }

  // Spec gate: does this user need to supply a parent-tier code on first
  // login? login_required_code returns one row when yes and an empty set
  // when no. The kind dictates which code the client prompts for.
  const { data: required, error: reqErr } = await supabase.rpc(
    "login_required_code",
    { _user_id: userId },
  );
  if (reqErr) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ error: reqErr.message }, { status: 500 });
  }
  const requiredRow = Array.isArray(required) ? required[0] : required;
  const codeKind = (requiredRow as { kind?: string } | null)?.kind ?? null;

  if (codeKind) {
    if (!code || typeof code !== "string" || !code.trim()) {
      // Password is good but the user needs to surface their code first.
      // Sign back out so the cookie-bound session doesn't persist while
      // the form is collecting the second factor.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return NextResponse.json(
        { ok: false, requires_code: true, code_kind: codeKind },
        { status: 200 },
      );
    }
    const { data: codeOk, error: verErr } = await supabase.rpc(
      "verify_login_code",
      { _user_id: userId, _code: code.trim() },
    );
    if (verErr) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return NextResponse.json({ error: verErr.message }, { status: 500 });
    }
    if (codeOk !== true) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return NextResponse.json(
        { ok: false, requires_code: true, code_kind: codeKind, error: "invalid_code" },
        { status: 400 },
      );
    }
  }

  // Mirror verify-otp: customer mode always to /room; staff mode resolves
  // by the user's highest role.
  let next = "/room";
  if (signInMode === "staff") {
    const { data: roleRows } = await supabase
      .from("user_role_names")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    next = landingForRoles(roles);
  }

  return NextResponse.json({ ok: true, next });
}
