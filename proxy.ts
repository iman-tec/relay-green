/*
 * Edge proxy — Supabase auth session refresh + route protection + geo-theme.
 *
 * Three jobs:
 *   1. Refresh the Supabase JWT on every request so the session stays alive
 *      (required by @supabase/ssr — without this the access token expires).
 *   2. Redirect clearly-unauthed traffic away from protected routes before
 *      it hits the React tree.
 *   3. Detect the visitor's country (from Vercel edge headers / request.geo)
 *      and write a `relay-theme-geo` cookie so the marketing site can auto-
 *      select the right theme (Nordics/Middle East → Espresso, Benelux+DE →
 *      Cloud KLM, NA/UK/AUS/SG → Moon, rest of world → Sun). Skipped when
 *      the visitor has an explicit `relay-theme-user` cookie from the
 *      manual theme switcher.
 *
 * Real authorization (role checks, RLS) happens server-side in route handlers
 * and RPCs, and client-side in useStaffGuard. This proxy is the fast edge layer.
 *
 * Replaces the legacy `middleware.ts` convention (deprecated in Next.js 16).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ISO 3166-1 alpha-2 country codes → theme id. Anything not listed falls
// through to "sun" (default white/peach theme).
const COUNTRY_TO_THEME: Record<string, "cream" | "dark" | "espresso" | "klm"> = {
  // Espresso — Nordics + Middle East
  SE: "espresso", NO: "espresso", DK: "espresso", FI: "espresso", IS: "espresso",
  AE: "espresso", SA: "espresso", QA: "espresso", KW: "espresso", BH: "espresso",
  OM: "espresso", IL: "espresso", JO: "espresso", LB: "espresso", EG: "espresso",
  // Cloud (KLM) — Benelux + Germany
  NL: "klm", BE: "klm", LU: "klm", DE: "klm",
  // Moon — North America + UK + Australia + Singapore
  US: "dark", CA: "dark", MX: "dark",
  GB: "dark", IE: "dark",
  AU: "dark", NZ: "dark",
  SG: "dark",
};

// Routes split by which login surface they belong to. Staff routes bounce
// unauthed traffic to /staff/login (the 8-digit-code experience); customer
// routes bounce to /login (the magic-link experience). Keeping them in two
// lists means a customer hitting /room while signed out lands on the right
// form instead of being asked for a staff OTP.
const STAFF_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/triage",
  "/supervise",
  "/admin",
  "/enterprise",
  "/reseller",
  "/department",
  "/staff/session",
];

const CUSTOMER_PREFIXES = [
  "/room",
  "/account",
];

const STAFF_LOGIN = "/staff/login";
const CUSTOMER_LOGIN = "/login";

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  // Route protection — redirect unauthenticated users on protected pages.
  // Staff routes bounce to /staff/login; customer routes (/room) bounce to
  // /login so the right form renders. Anything not listed (homepage,
  // marketing, /login itself) is left alone.
  const { pathname } = req.nextUrl;
  const isStaff    = matchesPrefix(pathname, STAFF_PREFIXES);
  const isCustomer = matchesPrefix(pathname, CUSTOMER_PREFIXES);

  if (isStaff || isCustomer) {
    // After the getUser() call above, the cookie may have been refreshed.
    // Check for a valid Supabase auth cookie to decide redirect.
    const hasSession = req.cookies
      .getAll()
      .some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));

    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = isStaff ? STAFF_LOGIN : CUSTOMER_LOGIN;
      return NextResponse.redirect(url);
    }
  }

  // Geo-theme cookie — set on every response unless the visitor has an
  // explicit user choice from the manual theme switcher. Short TTL so VPN /
  // travel changes refresh within a day. Not httpOnly because the
  // client-side ThemeSwitcher needs to read it on first paint.
  if (!req.cookies.get("relay-theme-user")) {
    const geoCountry =
      (req as NextRequest & { geo?: { country?: string } }).geo?.country ?? "";
    const headerCountry = req.headers.get("x-vercel-ip-country") ?? "";
    const country = (geoCountry || headerCountry).toUpperCase();
    const theme = COUNTRY_TO_THEME[country] ?? "cream";
    res.cookies.set("relay-theme-geo", theme, {
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
