/*
 * POST /api/auth/signin-password
 *
 * Server-side password sign-in. Invited users sign in here with the
 * temp password from their invite email; they'll be diverted to
 * /set-password so they can pick their own. Returning users with
 * password_set === true go straight to their landing.
 *
 * Input:  { email, password, mode?: "customer" | "staff" }
 * Output: { ok: true, next } | { error }
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
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data, error } = await supabase.auth.signInWithPassword({
    email:    email.trim().toLowerCase(),
    password,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const user = data.user;
  if (!user) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ error: "sign_in_unexpected_state" }, { status: 500 });
  }

  let next = "/room";
  if (signInMode === "staff") {
    const { data: roleRows } = await supabase
      .from("user_role_names")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    next = landingForRoles(roles);
  }

  // First-time sign-in with temp password — divert to /set-password so
  // the user picks their own. The set-password endpoint will write
  // app_metadata.password_set = true; subsequent sign-ins skip the
  // divert and land directly on `next`.
  const passwordSet =
    (user.app_metadata as Record<string, unknown> | undefined)?.password_set === true;
  if (!passwordSet) {
    const params = new URLSearchParams({ mode: signInMode, continue: next });
    return NextResponse.json({ ok: true, next: `/set-password?${params}` });
  }

  return NextResponse.json({ ok: true, next });
}
