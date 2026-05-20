/*
 * Returns the authenticated viewer's identity and role classification.
 * Mirrors the client-side logic in `lib/relay/useStaffGuard.ts` so the
 * Electron shell (and other native clients) can decide which widget to
 * mount after sign-in.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAFF_ROLE_SET: ReadonlySet<string> = new Set(STAFF_ROLES);

export async function GET() {
  const sb = await createClient();
  const { data: u, error: authErr } = await sb.auth.getUser();
  if (authErr || !u.user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const { data: rolesData } = await sb
    .from("user_role_names")
    .select("role")
    .eq("user_id", u.user.id);

  const roles = (rolesData ?? []).map((r: { role: string }) => r.role);
  const isStaff = roles.some((r) => STAFF_ROLE_SET.has(r));

  return NextResponse.json({
    userId: u.user.id,
    email: u.user.email ?? null,
    roles,
    role: isStaff ? "engineer" : "customer",
  });
}
