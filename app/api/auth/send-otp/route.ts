/*
 * Server-side OTP send.
 *
 * Why this exists: some browsers / networks block the direct
 * `supabase.auth.signInWithOtp` call from the client (corporate firewalls,
 * privacy extensions, self-signed dev-server cert contexts, etc.). The Node
 * runtime can always reach Supabase, so we proxy the call through here.
 *
 * Input  : { email }
 * Output : { ok: true } — always, for any valid email format.
 *
 * Account-enumeration safety (SEC-API-ENUM-1): signInWithOtp with
 * shouldCreateUser:false errors for a non-existent / non-actionable account.
 * Surfacing that error (as this route used to) discloses account existence
 * just like /api/auth/prepare did. We now swallow the send outcome, log it
 * server-side, and always return the same neutral 200. The only non-200 is
 * a state-independent malformed-email 400.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const { email } = await request.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false }, // user is pre-created by /api/auth/prepare
  });

  if (error) {
    // Enumeration-safe: a non-existent or non-actionable account makes
    // Supabase error here. Never surface it — log and answer neutrally so an
    // unauth caller can't distinguish "code sent" from "no such account".
    console.warn("[send-otp] signInWithOtp suppressed:", error.message);
  }
  return NextResponse.json({ ok: true });
}
