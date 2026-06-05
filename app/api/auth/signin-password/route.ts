/*
 * POST /api/auth/signin-password
 *
 * Server-side password sign-in. Invited users sign in here with the
 * temp password from their invite email; they'll be diverted to
 * /set-password so they can pick their own. Returning users with
 * password_set === true go straight to their landing.
 *
 * Input:  { email, password, surface?: "customer" | "staff" | "partner" | "business" }
 *         (legacy: { mode: "customer" | "staff" } still accepted)
 * Output: { ok: true, next } | { error, allowed_surface_url? }
 *
 * Role-gated: if the authenticated user's roles don't include any role
 * allowed on the requested surface, the session is rolled back and the
 * caller is told which surface they should be using instead.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";
import {
  SURFACE_ROLES,
  SURFACE_URL,
  isAllowedOnSurface,
  preferredSurfaceForRoles,
  type LoginSurface,
} from "@/lib/relay/loginSurface";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_SURFACES = new Set<LoginSurface>([
  "customer",
  "staff",
  "partner",
  "business",
]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    surface?: string;
    /** Legacy: callers still send `mode: "customer" | "staff"`. */
    mode?: string;
  };
  const { email, password } = body;
  if (
    !email ||
    typeof email !== "string" ||
    !password ||
    typeof password !== "string"
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Determine which login surface we're enforcing. New callers pass
  // `surface`; old callers pass `mode` (mapped: "customer" → customer,
  // anything else → staff). Default to "customer" so a missing param
  // doesn't escalate privilege.
  const surfaceParam = (body.surface ?? body.mode ?? "customer").toLowerCase();
  const surface: LoginSurface = VALID_SURFACES.has(surfaceParam as LoginSurface)
    ? (surfaceParam as LoginSurface)
    : "customer";

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const user = data.user;
  if (!user) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json(
      { error: "sign_in_unexpected_state" },
      { status: 500 }
    );
  }

  // Pull the authenticated user's roles. Required for every surface so we
  // can both gate AND compute landing.
  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  // Hard gate: reject any user whose role isn't admitted on the surface
  // they're trying to use. Sign them out cleanly + tell the form which
  // surface they should be using instead. Without this anyone with valid
  // creds could sign in via any surface (only the post-login redirect
  // would differ).
  if (!isAllowedOnSurface(roles, surface)) {
    await supabase.auth.signOut({ scope: "global" }).catch(() => {});
    const allowed = preferredSurfaceForRoles(roles);
    return NextResponse.json(
      {
        error: "wrong_login_surface",
        allowed_surface: allowed,
        allowed_surface_url: SURFACE_URL[allowed],
        allowed_roles_here: SURFACE_ROLES[surface],
      },
      { status: 403 }
    );
  }

  // Customer surface: landing is always /room regardless of which other
  // roles the user happens to hold. Staff/partner/business: use the role
  // hierarchy to pick the right console.
  const next = surface === "customer" ? "/room" : landingForRoles(roles);

  // First-time sign-in with temp password — divert to /set-password so
  // the user picks their own. The set-password endpoint will write
  // app_metadata.password_set = true; subsequent sign-ins skip the
  // divert and land directly on `next`.
  const passwordSet =
    (user.app_metadata as Record<string, unknown> | undefined)?.password_set ===
    true;
  if (!passwordSet) {
    const params = new URLSearchParams({ surface, continue: next });
    return NextResponse.json({ ok: true, next: `/set-password?${params}` });
  }

  return NextResponse.json({ ok: true, next });
}
