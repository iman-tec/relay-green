/*
 * Pre-creates a Supabase auth user (idempotent) so the next signInWithOtp
 * triggers the "Magic Link" email template (which is configured for OTP
 * codes) instead of the "Confirm signup" template (which sends a link).
 *
 * This is the workaround when the Confirm-signup template hasn't been
 * updated to use {{ .Token }}.
 *
 * Public route — anyone can hit this with any email. The risk is creating
 * empty user rows for emails that never sign in. Mitigation: rate-limit
 * via a simple in-memory IP guard (good enough for early dev).
 *
 * ── Account-enumeration safety (SEC-API-ENUM-1) ────────────────────────
 * This endpoint MUST NOT disclose whether an email has an account or what
 * lifecycle state it's in. It previously returned 404 `email_not_found`
 * (forgot + unknown) and 409 `email_exists` (first-time + existing), plus a
 * `status: exists|created` body — each an enumeration oracle for an unauth
 * caller. It now performs the correct server-side provisioning silently and
 * ALWAYS returns the same neutral `{ ok: true }` regardless of account
 * state. The only non-200s are state-independent: invalid email *format*
 * (400), rate limit (429), server misconfig (500).
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Crude in-process rate limiter: max 6 requests / IP / minute
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (b.count >= 6) return false;
  b.count += 1;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          ?? request.headers.get("x-real-ip")
          ?? "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { email, purpose } = await request.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // `purpose` selects the provisioning semantics (NOT the response shape —
  // the response is always neutral):
  //   "forgot"     → never create a user (a typo must not mint an account).
  //   "first-time" → create the user if absent (brand-new signup).
  //   undefined    → legacy "ensure-exists" sign-in: create if absent.
  const intent: "first-time" | "forgot" | "any" =
    purpose === "first-time" ? "first-time" :
    purpose === "forgot"     ? "forgot"     :
                               "any";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "supabase_env_missing" }, { status: 500 });
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Do the real provisioning work, but never let its outcome change the
  // response. Any error is logged server-side and swallowed so the response
  // shape can't be used to probe account state.
  try {
    // Look up by email — admin.listUsers doesn't support filter, so paginate
    // a single page (works fine while user count is small).
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    // Only the "forgot" flow refrains from creating; for an existing account
    // (any intent) there's nothing to do — the next OTP uses the Magic Link
    // template either way. For first-time/legacy with no account, pre-create.
    if (!existing && intent !== "forgot") {
      const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      // "already registered" races are fine — the user exists, which is all
      // we needed. Anything else we log but still answer neutrally.
      if (error && !error.message.toLowerCase().includes("already")) {
        console.warn("[prepare] createUser error:", error.message);
      }
    }
  } catch (e) {
    console.warn("[prepare] provisioning error:", e instanceof Error ? e.message : e);
  }

  // Uniform neutral response regardless of account existence or lifecycle.
  return NextResponse.json({ ok: true });
}
