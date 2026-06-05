/*
 * Server-side email-OTP verify.
 *
 * Used by the Supabase invite + recovery email templates when they
 * link to `?token_hash=...&type=...`. We verify the token (which sets
 * the session cookie via the SSR client) and then hand off to the
 * shared post-auth router.
 *
 * Why this exists alongside /auth/callback: that one handles the
 * legacy ?code=… PKCE flow. token_hash is the recommended pattern for
 * @supabase/ssr because it works fully server-side — no token in the
 * URL fragment, no client-side JS required.
 */

import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { routeAfterAuth } from "@/lib/auth-post-signin";

export const dynamic = "force-dynamic";

const VALID_TYPES: ReadonlySet<EmailOtpType> = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!token_hash || !type || !VALID_TYPES.has(type)) {
    return NextResponse.redirect(
      `${origin}/login?error=auth_confirm_bad_params`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) {
    console.warn("[auth/confirm] verifyOtp failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_confirm_failed`);
  }

  return routeAfterAuth(supabase, request);
}
