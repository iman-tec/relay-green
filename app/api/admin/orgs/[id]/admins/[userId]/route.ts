/*
 * Remove an enterprise admin from an org.
 *
 * DELETE /api/admin/orgs/:id/admins/:userId
 *   Drops the enterprise_admin role grant + clears profile.organization_id
 *   on that user. Doesn't delete their auth account — they can be assigned
 *   elsewhere later, or kept around with no org binding.
 *
 * Mirrors the dept-admin detach pattern. Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id: orgId, userId } = await params;

  // Verify the profile actually belongs to this org — defends against
  // guessed URLs.
  const { data: prof } = await admin
    .from("profiles")
    .select("id, organization_id, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const p = prof as {
    id: string;
    organization_id: string | null;
    primary_role_id: string | null;
  } | null;
  if (!p) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (p.organization_id !== orgId) {
    return NextResponse.json({ error: "User isn't bound to this org." }, { status: 409 });
  }

  // Drop the enterprise_admin role grant. Other roles (super_admin, etc.)
  // stay intact.
  const { data: roleRow } = await admin
    .from("roles").select("id").eq("name", ROLE.enterprise_admin).maybeSingle();
  const entAdminRoleId = (roleRow as { id: string } | null)?.id;
  if (entAdminRoleId) {
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role_id", entAdminRoleId);
  }

  // If primary_role was enterprise_admin, clear it so the user doesn't
  // remain "primarily an enterprise admin" without a grant.
  const profileUpdate: Record<string, unknown> = { organization_id: null };
  if (p.primary_role_id === entAdminRoleId) {
    profileUpdate.primary_role_id = null;
  }

  const { error } = await admin.from("profiles").update(profileUpdate).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
