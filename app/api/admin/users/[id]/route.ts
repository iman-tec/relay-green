/*
 * Admin users API — update + delete by id.
 *
 * PATCH  /api/admin/users/:id   { displayName?, role?, status? }
 *   - displayName updates profiles.full_name
 *   - role replaces user_roles (single staff role per user for now)
 *   - status ∈ {ACTIVE, DEACTIVATED} bans/unbans the auth user
 *
 * DELETE /api/admin/users/:id
 *   Hard-deletes the auth user. Cascades to profiles + user_roles via FK.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CREATABLE_ROLES = new Set([
  "engineer",
  "pod_lead",
  "super_admin",
  "admin",
]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, user: actor } = gate;

  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json(
      { error: "You can't edit your own super-admin record from here." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const displayName: unknown = body.displayName;
  const role: unknown        = body.role;
  const status: unknown      = body.status;

  if (typeof displayName === "string" && displayName.trim()) {
    const { error } = await admin
      .from("profiles")
      .update({ full_name: displayName.trim() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof role === "string") {
    if (!CREATABLE_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Role must be engineer, pod_lead, super_admin, or admin." },
        { status: 400 },
      );
    }
    // Single staff role per user: clear the staff roles, then re-insert.
    // We don't touch builder/customer rows here.
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", id)
      .in("role", ["engineer", "pod_lead", "ops_manager", "admin"]);
    const { error: insertErr } = await admin
      .from("user_roles")
      .insert({ user_id: id, role });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    await admin
      .from("profiles")
      .update({ primary_role: role })
      .eq("id", id);
  }

  if (typeof status === "string") {
    if (status === "DEACTIVATED") {
      // 100 years = effectively permanent until reactivated.
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: "876000h",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (status === "ACTIVE") {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: "none",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      return NextResponse.json(
        { error: "Status must be ACTIVE or DEACTIVATED." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, user: actor } = gate;

  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json(
      { error: "You can't delete your own super-admin record." },
      { status: 400 },
    );
  }

  // Super Admins are a protected tier — no one (not even another Super
  // Admin) can delete them through the admin UI. Removal must go through
  // the bootstrap script.
  const { data: targetRoles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", id);
  const isSuper = (targetRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (isSuper) {
    return NextResponse.json(
      { error: "Super Admins can't be deleted from the admin UI." },
      { status: 403 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
