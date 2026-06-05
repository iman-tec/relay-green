/*
 * Test-only auth bypass.
 * Accepts { access_token, refresh_token } and writes the SSR auth cookies
 * via the server Supabase client. Used by Playwright tests so they don't
 * have to drive the real OTP flow.
 *
 * Only enabled when NODE_ENV !== "production".
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { access_token, refresh_token } = await request.json();
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "missing tokens" }, { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
