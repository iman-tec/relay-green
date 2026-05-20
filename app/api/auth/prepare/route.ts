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

  // `purpose` lets the caller pick which existence-check semantics apply:
  //   "first-time" → email MUST NOT exist; we create the user.
  //   "forgot"     → email MUST exist; we don't create.
  //   undefined    → legacy "ensure-exists" behavior (sign-in via OTP).
  // Anything else is treated as undefined.
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

  // Look up by email — admin.listUsers doesn't support filter, so paginate
  // a single page (works fine while user count is small).
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (intent === "first-time" && existing) {
    return NextResponse.json({ error: "email_exists" }, { status: 409 });
  }
  if (intent === "forgot" && !existing) {
    return NextResponse.json({ error: "email_not_found" }, { status: 404 });
  }

  if (existing) {
    // Already exists — Supabase will use the Magic Link template on the next OTP call.
    return NextResponse.json({ ok: true, status: "exists" });
  }

  // Create the user pre-confirmed. The next signInWithOtp will then use the
  // Magic Link template (configured for OTP codes), not Confirm Signup.
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) {
    // If it failed with "already registered" race, treat as success
    // (unless the caller specifically wanted a brand-new email).
    if (error.message.toLowerCase().includes("already")) {
      if (intent === "first-time") {
        return NextResponse.json({ error: "email_exists" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, status: "race_resolved" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "created" });
}
