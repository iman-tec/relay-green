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
import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";
import { toRoles } from "@/lib/relay/roles";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import { attributeIndividualReferral } from "@/lib/billing/individualReferral";
import { REF_COOKIE } from "@/lib/billing/referralCookie";
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
  const reqBody = (await request.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
    mode?: string;
    surface?: string;
    purpose?: string;
  };
  const { email, code, purpose } = reqBody;
  if (
    !email ||
    typeof email !== "string" ||
    !code ||
    typeof code !== "string"
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  // Determine which login surface the OTP belongs to. New callers pass
  // `surface`; legacy callers pass `mode: "customer" | "staff"`. Default
  // to "customer" — a missing param should never silently escalate.
  const surfaceParam = (
    reqBody.surface ??
    reqBody.mode ??
    "customer"
  ).toLowerCase();
  const surface: LoginSurface = VALID_SURFACES.has(surfaceParam as LoginSurface)
    ? (surfaceParam as LoginSurface)
    : "customer";
  // Legacy alias preserved for the /set-password URL params downstream.
  const signInMode: "customer" | "staff" =
    surface === "customer" ? "customer" : "staff";
  // `purpose` tells us why the user is in the OTP flow:
  //   "first-time" → brand-new signup, divert to /set-password.
  //   "forgot"     → forgotten password, force divert regardless of flag.
  //   undefined    → ordinary OTP sign-in; respect the password_set flag.
  const purposeIntent: "first-time" | "forgot" | "signin" =
    purpose === "first-time"
      ? "first-time"
      : purpose === "forgot"
        ? "forgot"
        : "signin";

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
    type: "email",
  });

  if (error) {
    // Pass Supabase's message through verbatim so the UI can surface it
    // ("Invalid token", "Token has expired", etc.).
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Customer-mode sign-ins always go to /room. Other surfaces resolve by
  // the user's most-privileged role. We always pull roles so we can gate
  // (regardless of mode) — a user whose role isn't admitted on `surface`
  // must be signed out and bounced to their correct surface.
  const userId = verified.user?.id;
  let next: string = surface === "customer" ? "/room" : "/dashboard";
  if (userId) {
    const { data: roleRows } = await supabase
      .from("user_role_names")
      .select("role")
      .eq("user_id", userId);
    const roles = toRoles(
      (roleRows ?? []).map((r: { role: string }) => r.role)
    );
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
    if (surface !== "customer") next = landingForRoles(roles);
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
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        try {
          const admin = createAdminClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: hasPw, error: hasPwErr } = await admin.rpc(
            "user_has_password",
            { _user_id: userId }
          );
          if (hasPwErr) {
            console.warn(
              "[verify-otp] user_has_password RPC error:",
              hasPwErr.message
            );
          } else if (hasPw === false) {
            next = `/set-password?mode=${signInMode}&continue=${encodeURIComponent(next)}`;
          }
        } catch (e) {
          console.warn(
            "[verify-otp] has-password admin check failed:",
            e instanceof Error ? e.message : e
          );
        }
      } else {
        console.warn(
          "[verify-otp] supabase service-role env missing — skipping has-password check"
        );
      }
    }
  }

  // Channel-partner: attribute an organic individual to the referring partner
  // if they arrived via a ?ref=<reseller_code> link. Idempotent + organic-only
  // (enterprise/staff users are skipped inside the helper), so it's safe on
  // every customer verify. Flag-off → skipped entirely. The cookie is consumed
  // after one attempt so it doesn't linger across future logins.
  let clearRefCookie = false;
  if (surface === "customer" && userId && partnerProgramEnabled()) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      try {
        const refCode = (await cookies()).get(REF_COOKIE)?.value;
        if (refCode) {
          const admin = createAdminClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          await attributeIndividualReferral(admin, userId, refCode);
          clearRefCookie = true;
        }
      } catch (e) {
        console.warn(
          "[verify-otp] referral attribution failed:",
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  const res = NextResponse.json({ ok: true, next });
  if (clearRefCookie) res.cookies.set(REF_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
