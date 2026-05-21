/*
 * Supabase auth callback (PKCE flow).
 *
 * Handles the ?code=… redirect from signInWithOtp / OAuth. For the
 * token_hash flow used by invite + recovery emails, see /auth/confirm.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { routeAfterAuth } from "@/lib/auth-post-signin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_no_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("[auth/callback] exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  return routeAfterAuth(supabase, request);
}
