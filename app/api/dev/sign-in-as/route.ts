/*
 * Dev-only one-click sign-in bypass.
 *
 * GET /api/dev/sign-in-as?role=engineer
 *   → signs in as the demo account for that role (via known password)
 *   → sets the SSR auth cookies on the redirect response
 *   → 302 redirects to the role's landing page
 *
 * The five demo accounts are provisioned by scripts/reset.mjs and share
 * the password constant DEMO_PASSWORD ("RelayDev123!"). Anyone who can
 * hit this route can become any role — so it's hard-disabled in
 * production via NODE_ENV.
 */

import { NextResponse } from "next/server";
import { createClient as createBrowserStyleClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEMO_PASSWORD = "RelayDev123!";

// Customer-side bypass is intentionally absent — production demo flow goes
// through real OTP. Only staff roles get the one-click sign-in for testing.
const ROLE_TO_USER: Record<string, { email: string; landing: string }> = {
  engineer: { email: "dev.soni@thegatewaycorp.co.in", landing: "/dashboard" },
  supervisor: { email: "supervisor.demo@relay.test", landing: "/supervise" },
  internal: { email: "admin.demo@relay.test", landing: "/admin" },
  enterprise: { email: "enterprise.demo@relay.test", landing: "/enterprise" },
};

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "forbidden_in_production" },
      { status: 403 }
    );
  }

  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  // Trust the actual incoming Host header — `request.url` sometimes reports
  // the loopback (127.0.0.1) under Next dev even when the user visited via
  // the LAN IP. That would cause us to redirect them off-host. The Host
  // header reflects what the browser actually sent.
  const host = request.headers.get("host") ?? requestUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    requestUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const role = (searchParams.get("role") ?? "").toLowerCase();
  const target = ROLE_TO_USER[role];
  if (!target) {
    return NextResponse.json(
      { error: "unknown_role", valid_roles: Object.keys(ROLE_TO_USER) },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "supabase_env_missing" },
      { status: 500 }
    );
  }

  // Anon-key client to perform a real signInWithPassword.
  const anon = createBrowserStyleClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signed, error: signErr } = await anon.auth.signInWithPassword({
    email: target.email,
    password: DEMO_PASSWORD,
  });
  if (signErr || !signed?.session) {
    return NextResponse.json(
      { error: "demo_signin_failed", detail: signErr?.message ?? "no session" },
      { status: 500 }
    );
  }

  const next = searchParams.get("next") ?? target.landing;
  const response = NextResponse.redirect(`${origin}${next}`);

  // Write SSR auth cookies directly onto the redirect response.
  // Using cookies() from next/headers + returning NextResponse.redirect() is a
  // separate response object — cookies set via cookieStore.set() do NOT
  // propagate to the redirect. We must write directly to response.cookies.
  const server = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [],
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options ?? {});
        });
      },
    },
  });
  const { error: setErr } = await server.auth.setSession({
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
  });
  if (setErr) {
    return NextResponse.json(
      { error: "set_session_failed", detail: setErr.message },
      { status: 500 }
    );
  }

  return response;
}
