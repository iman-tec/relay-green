/*
 * First-login OTP send (code-gated).
 *
 * Spec requires inorganic enterprise admins, department admins, and
 * employees to supply a code along with their email on first login:
 *
 *   • inorganic enterprise admin → reseller_code (RLC-…)
 *   • department admin           → enterprise_code (slug-…)
 *   • employee                   → department_code (DLC-…)
 *
 * After they set a password they switch to /api/auth/signin-password
 * (no code required). Resellers and organic enterprise admins skip the
 * code entirely on first login as well.
 *
 * This route validates the code against the user's expected one (via the
 * existing `verify_login_code` RPC) BEFORE handing the email off to the
 * standard Supabase OTP path. /api/auth/send-otp continues to serve the
 * no-code flows (resellers, organic enterprises, forgot-password, etc.).
 *
 * Input  : { email, code? }
 * Output : { ok: true } on success; { error } on failure.
 */

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const { email, code } = (await request.json().catch(() => ({}))) as {
    email?: string;
    code?:  string;
  };

  if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const cleanEmail = email.trim().toLowerCase();

  // Service-role admin client — needed to look up the user by email and
  // call the SECURITY DEFINER RPCs with an explicit user_id.
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "supabase_env_missing" }, { status: 500 });
  }
  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up the user by email. listUsers doesn't filter; paginate a
  // single page (works fine while user count is small — same pattern as
  // /api/auth/prepare).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const userRow = list?.users?.find((u) => u.email?.toLowerCase() === cleanEmail);
  if (!userRow) {
    return NextResponse.json({ error: "email_not_found" }, { status: 404 });
  }

  // Resolve the expected code (kind + value) for this user. Resellers
  // and organic enterprise admins return null — for them a code is not
  // required, so we accept the request without one.
  const { data: required, error: reqErr } = await admin.rpc("login_required_code", {
    _user_id: userRow.id,
  });
  if (reqErr) {
    return NextResponse.json({ error: reqErr.message }, { status: 500 });
  }
  const requiredRow = Array.isArray(required) ? required[0] : required;
  const codeRequired = !!requiredRow?.code;

  if (codeRequired) {
    if (!code || typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "code_required" }, { status: 400 });
    }
    const { data: ok, error: verErr } = await admin.rpc("verify_login_code", {
      _user_id: userRow.id,
      _code:    code.trim(),
    });
    if (verErr) {
      return NextResponse.json({ error: verErr.message }, { status: 500 });
    }
    if (ok !== true) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
  }

  // Code accepted (or not required) — hand the email off to the existing
  // OTP send path. We call signInWithOtp through the cookie-bound server
  // client so any redirect/SMTP config tied to the request context applies.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: { shouldCreateUser: false },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
