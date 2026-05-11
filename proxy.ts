/*
 * Edge proxy — Supabase auth presence check.
 *
 * Cheap cookie sniff at the Edge. Real authorization (role, RLS) happens
 * server-side in route handlers / RPCs / via useStaffGuard on the client.
 * This proxy just redirects clearly-unauthed traffic before it hits the
 * React tree on protected routes.
 *
 * Replaces the legacy `middleware.ts` file convention (deprecated in Next.js 16).
 */

import { NextResponse, type NextRequest } from "next/server";

// Supabase SSR uses cookies named `sb-<project_ref>-auth-token` (and a
// potential `-code-verifier` companion). We sniff for any cookie whose
// name starts with `sb-` and ends with `-auth-token`.
const SUPABASE_AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

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

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  const hasSupabaseSession = req.cookies
    .getAll()
    .some((c) => SUPABASE_AUTH_COOKIE_RE.test(c.name));

  if (!hasSupabaseSession) {
    const url = req.nextUrl.clone();
    url.pathname = STAFF_LOGIN;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbox/:path*",
    "/triage/:path*",
    "/supervise/:path*",
    "/admin/:path*",
    "/enterprise/:path*",
    "/staff/session/:path*",
  ],
};
