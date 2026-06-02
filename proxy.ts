/*
 * Edge proxy — Supabase auth session refresh + route protection + geo-theme.
 *
 * Three jobs:
 *   1. Refresh the Supabase JWT on every request so the session stays alive
 *      (required by @supabase/ssr — without this the access token expires).
 *   2. Redirect clearly-unauthed traffic away from protected routes before
 *      it hits the React tree.
 *   3. Detect the visitor's country (from Vercel edge headers / request.geo)
 *      and write a `relay-theme-geo` cookie so both surfaces can auto-select
 *      the right theme (Nordics/Eastern-Europe/Middle-East → Espresso,
 *      Benelux+DE+FR → Cloud KLM, NA/UK/AUS/SG → Moon, rest of world → Sun).
 *      Skipped when the visitor has an explicit `relay-theme-user` cookie
 *      from the manual theme switcher. The country→theme map lives in
 *      lib/relay/theme.ts (shared + unit-tested).
 *
 * Real authorization (role checks, RLS) happens server-side in route handlers
 * and RPCs, and client-side in useStaffGuard. This proxy is the fast edge layer.
 *
 * Replaces the legacy `middleware.ts` convention (deprecated in Next.js 16).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { GEO_COOKIE, USER_COOKIE, themeForCountry } from "./lib/relay/theme";

// Routes split by which login surface their audience belongs to. Each
// surface has its own URL — unauthed traffic on a protected prefix is
// redirected to the matching surface so a recipient hits the right form
// (no "asked for a staff OTP on the customer page" confusion). Real
// authorization (role checks, RLS) lives server-side; this is the fast
// edge layer.
//
// Surface mapping:
//   customer  → /login       (client)
//   staff     → /staff       (super_admin / supervisor / engineer)
//   partner   → /partner     (reseller — "Channel Partner")
//   business  → /business    (enterprise_admin / department_admin / dept member)
const STAFF_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/quotations",
  "/triage",
  "/supervise",
  "/admin",
  "/calendar",
  "/finance",
  "/operations",
  "/schedule",
  "/settings",
  "/session-review",
  "/staff/session",
  "/staff/project",
  "/staff/onboarding",
];

const PARTNER_PREFIXES = ["/reseller"];

const BUSINESS_PREFIXES = ["/enterprise", "/department"];

const CUSTOMER_PREFIXES = ["/room", "/account"];

const STAFF_LOGIN = "/staff";
const PARTNER_LOGIN = "/partner";
const BUSINESS_LOGIN = "/business";
const CUSTOMER_LOGIN = "/login";

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function loginForPath(pathname: string): string | null {
  if (matchesPrefix(pathname, STAFF_PREFIXES)) return STAFF_LOGIN;
  if (matchesPrefix(pathname, PARTNER_PREFIXES)) return PARTNER_LOGIN;
  if (matchesPrefix(pathname, BUSINESS_PREFIXES)) return BUSINESS_LOGIN;
  if (matchesPrefix(pathname, CUSTOMER_PREFIXES)) return CUSTOMER_LOGIN;
  return null;
}

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
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          );
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    });
    await supabase.auth.getUser();
  }

  // Route protection — redirect unauthenticated users on protected pages
  // to the login surface their audience belongs to (see SURFACE_URL in
  // lib/relay/loginSurface.ts). Anything not listed (homepage, marketing,
  // login surfaces themselves) is left alone.
  const { pathname } = req.nextUrl;
  const target = loginForPath(pathname);

  if (target) {
    // After the getUser() call above, the cookie may have been refreshed.
    // Check for a valid Supabase auth cookie to decide redirect.
    const hasSession = req.cookies
      .getAll()
      .some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));

    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url);
    }
  }

  // Geo-theme cookie — set on every response unless the visitor has an
  // explicit user choice from the manual theme switcher. Short TTL so VPN /
  // travel changes refresh within a day. Not httpOnly because the
  // pre-paint script + client switchers need to read it on first paint.
  if (!req.cookies.get(USER_COOKIE)) {
    const geoCountry =
      (req as NextRequest & { geo?: { country?: string } }).geo?.country ?? "";
    const headerCountry = req.headers.get("x-vercel-ip-country") ?? "";
    const theme = themeForCountry(geoCountry || headerCountry);
    res.cookies.set(GEO_COOKIE, theme, {
      path: "/",
      maxAge: 60 * 60 * 24,
      sameSite: "lax",
    });
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
