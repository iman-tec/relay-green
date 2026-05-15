/*
 * Organization API — delete one.
 *
 * DELETE /api/admin/orgs/:id
 *   Removes the organization row. Members are NOT deleted (they keep
 *   their auth + profile rows) — only the org link on their profile is
 *   cleared, mirroring "leave organization" semantics. The org's
 *   enterprise admins are demoted to plain builders.
 *
 *   Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const { id } = await params;

  // Detach profiles from the org so we don't leave dangling FKs.
  const { data: memberRows, error: memberErr } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", id);
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  const memberIds = (memberRows ?? []).map((p: { id: string }) => p.id);

  if (memberIds.length) {
    const { error: detachErr } = await admin
      .from("profiles")
      .update({ organization_id: null })
      .in("id", memberIds);
    if (detachErr) {
      return NextResponse.json({ error: detachErr.message }, { status: 500 });
    }
    // Drop the enterprise_admin role from the org's admins — without an
    // org, that role doesn't mean anything.
    await admin
      .from("user_roles")
      .delete()
      .in("user_id", memberIds)
      .eq("role", "enterprise_admin");
  }

  const { error: orgErr } = await admin
    .from("organizations")
    .delete()
    .eq("id", id);
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
