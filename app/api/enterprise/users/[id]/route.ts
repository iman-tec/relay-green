/*
 * Enterprise admin: remove a member from their org.
 *
 * DELETE /api/enterprise/users/[id]
 *   Strictly scoped: target must already belong to caller's org.
 *   Cannot delete an enterprise_admin (you can't drop yourself or a peer
 *   admin via this endpoint — escalate to super_admin to demote).
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  const { id: targetId } = await params;
  if (targetId === actor.id) {
    return NextResponse.json(
      { error: "Can't remove yourself." },
      { status: 400 }
    );
  }

  const { data: target } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.organization_id !== orgId) {
    return NextResponse.json(
      { error: "Not in your organization." },
      { status: 404 }
    );
  }

  const { data: targetRoles } = await admin
    .from("user_role_names")
    .select("role")
    .eq("user_id", targetId);
  const isEntAdmin = (targetRoles ?? []).some(
    (r: { role: string }) => r.role === ROLE.enterprise_admin
  );
  if (isEntAdmin) {
    return NextResponse.json(
      { error: "Enterprise admins can only be removed by a super admin." },
      { status: 403 }
    );
  }

  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
