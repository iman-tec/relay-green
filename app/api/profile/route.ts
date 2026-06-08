/*
 * PATCH /api/profile
 *   Body: { displayName: string }
 *   Updates the CALLER's own profile name (profiles.full_name for auth.uid()).
 *   Surface-agnostic self-update — used by the partner / department / enterprise
 *   Settings → Profile section. Self-only; never another user. Additive, no
 *   money path.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    displayName?: string;
  };
  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (displayName.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 500 }
    );
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin
    .from("profiles")
    .update({ full_name: displayName })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, displayName });
}
