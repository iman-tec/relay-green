/*
 * Returns the authenticated viewer's identity and role classification.
 * Mirrors the client-side logic in `lib/relay/useStaffGuard.ts` so the
 * Electron shell (and other native clients) can decide which widget to
 * mount after sign-in.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAFF_ROLES = ["engineer", "pod_lead", "ops_manager", "admin"];

export async function GET() {
  const sb = await createClient();
  const { data: u, error: authErr } = await sb.auth.getUser();
  if (authErr || !u.user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const { data: rolesData } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);

  const roles = (rolesData ?? []).map((r) => r.role as string);
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));

  return NextResponse.json({
    userId: u.user.id,
    email: u.user.email ?? null,
    roles,
    role: isStaff ? "engineer" : "customer",
  });
}
