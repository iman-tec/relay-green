/*
 * Edge proxy — Supabase auth session refresh + route protection.
 *
 * Two jobs:
 *   1. Refresh the Supabase JWT on every request so the session stays alive
 *      (required by @supabase/ssr — without this the access token expires).
 *   2. Redirect clearly-unauthed traffic away from protected routes before
 *      it hits the React tree.
 *
 * Real authorization (role checks, RLS) happens server-side in route handlers
 * and RPCs, and client-side in useStaffGuard. This proxy is the fast edge layer.
 *
 * Replaces the legacy `middleware.ts` convention (deprecated in Next.js 16).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/triage",
  "/supervise",
  "/admin",
  "/enterprise",
  "/staff/session",
];

const STAFF_LOGIN = "/staff/login";

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  // Refresh the Supabase session — keeps the JWT alive across page loads.
  // createServerClient writes updated cookies back onto the response.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    });
    await supabase.auth.getUser();
  }

  // Route protection — redirect unauthenticated users on staff pages.
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isProtected) {
    // After the getUser() call above, the cookie may have been refreshed.
    // Check for a valid Supabase auth cookie to decide redirect.
    const hasSession = req.cookies
      .getAll()
      .some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));

    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = STAFF_LOGIN;
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
