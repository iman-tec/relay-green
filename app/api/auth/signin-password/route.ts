/*
 * POST /api/auth/signin-password
 *
 * Server-side password sign-in. Mirrors /api/auth/verify-otp's contract so
 * the SignInForm / StaffLoginForm can swap them interchangeably.
 *
 * Why server-side: corporate networks / privacy extensions sometimes
 * block the browser-to-Supabase fetch ("Failed to fetch"). The Node
 * runtime always has connectivity. Same reason as /api/auth/send-otp.
 *
 * Input:  { email, password, mode?: "customer" | "staff" }
 * Output: { ok: true, next } on success; { error } on failure.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const { email, password, mode } = (await request.json().catch(() => ({}))) as {
    email?:    string;
    password?: string;
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

  // Mirror verify-otp: customer mode always to /room; staff mode resolves
  // by the user's highest role.
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
