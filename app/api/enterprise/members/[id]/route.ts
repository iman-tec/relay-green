/*
 * Enterprise admin: toggle a member's sign-in access (deactivate / reactivate).
 *
 * PATCH /api/enterprise/members/:id
 *   Body: { status: "ACTIVE" | "DEACTIVATED" }
 *   Bans (DEACTIVATED) or unbans (ACTIVE) the auth user. The enterprise
 *   member/employee lists derive their status badge from the auth ban, so
 *   this is what flips "active" ↔ "suspended" in the UI.
 *
 *   Scoped + guarded so an enterprise admin can only act inside their own
 *   org and can't lock out themselves or a peer enterprise_admin:
 *     - target must belong to the caller's org                 → else 404
 *     - target must not be the caller                          → else 400
 *     - target must not hold enterprise_admin (super-admin job) → else 403
 *
 * Replaces the previous wiring to /api/admin/users/:id, which is
 * super_admin-only and 403'd for the enterprise admins who actually use
 * the Departments tab.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { banUser, unbanUser } from "@/lib/auth-ban";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  if (id === actor.id) {
    return NextResponse.json({ error: "cannot_modify_self" }, { status: 400 });
  }

  const { status } = (await request.json().catch(() => ({}))) as { status?: string };
  if (status !== "ACTIVE" && status !== "DEACTIVATED") {
    return NextResponse.json({ error: "status must be ACTIVE or DEACTIVATED" }, { status: 400 });
  }

  // Target must be in the caller's org.
  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!target || (target as { organization_id: string | null }).organization_id !== orgId) {
    return NextResponse.json({ error: "not_in_org" }, { status: 404 });
  }

  // Peer enterprise_admins are managed by a super admin, not laterally.
  const { data: targetRoles } = await admin
    .from("user_role_names")
    .select("role")
    .eq("user_id", id);
  const isEntAdmin = (targetRoles ?? []).some(
    (r: { role: string }) => r.role === ROLE.enterprise_admin,
  );
  if (isEntAdmin) {
    return NextResponse.json(
      { error: "Enterprise admins can only be changed by a super admin." },
      { status: 403 },
    );
  }

  if (status === "DEACTIVATED") await banUser(admin, id);
  else                          await unbanUser(admin, id);

  return NextResponse.json({ ok: true, status });
}
