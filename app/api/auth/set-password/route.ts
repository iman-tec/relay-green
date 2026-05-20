/*
 * POST /api/auth/set-password
 *
 * Sets (or replaces) the password on the currently signed-in user.
 * Called from /set-password after the user has just verified an OTP —
 * Supabase requires an active session for auth.updateUser({ password }),
 * which we have via cookies.
 *
 * Also computes the user's role-aware landing URL so the caller can
 * navigate to /room or /dashboard / etc. in one hop after success.
 *
 * Input:  { password, mode?: "customer" | "staff" }
 * Output: { ok: true, next } on success; { error } on failure.
 */

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Same rule as Supabase's default for now: minimum 8 characters. No
// complexity rules — modern guidance is length > complexity.
const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request) {
  const { password, mode } = (await request.json().catch(() => ({}))) as {
    password?: string;
    mode?:     string;
  };
  if (
    !password || typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Mark the user as having explicitly set their own password. The
  // post-OTP divert in /api/auth/verify-otp reads this flag (via the
  // user_has_password RPC) to decide whether to send the user through
  // /set-password again. We use raw_app_meta_data — admin-writable only,
  // so it's a trustworthy signal — and we write it via the service-role
  // admin client because supabase.auth.updateUser can't touch
  // app_metadata.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    try {
      const admin = createAdminClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: flagErr } = await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...(user.app_metadata ?? {}), password_set: true },
      });
      if (flagErr) {
        console.warn("[set-password] password_set flag write failed:", flagErr.message);
      }
    } catch (e) {
      console.warn("[set-password] password_set flag write threw:", e instanceof Error ? e.message : e);
    }
  } else {
    console.warn("[set-password] supabase service-role env missing — skipping password_set flag");
  }

  // Resolve the role-aware landing URL so the caller's navigation lands
  // in the right place. Customer mode short-circuits to /room.
  const signInMode: "customer" | "staff" =
    mode === "customer" ? "customer" : "staff";
  let next = "/room";
  if (signInMode === "staff") {
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    next = landingForRoles(roles);
  }

  return NextResponse.json({ ok: true, next });
}
