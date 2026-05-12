/*
 * Server-side OTP send.
 *
 * Why this exists: some browsers / networks block the direct
 * `supabase.auth.signInWithOtp` call from the client (corporate firewalls,
 * privacy extensions, self-signed dev-server cert contexts, etc.). The Node
 * runtime can always reach Supabase, so we proxy the call through here.
 *
 * Input  : { email }
 * Output : { ok: true } on success; { error } with a 4xx/5xx on failure.
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
