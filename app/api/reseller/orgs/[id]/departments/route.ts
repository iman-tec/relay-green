/*
 * Reseller-scoped department creation.
 *
 * POST /api/reseller/orgs/:id/departments
 *   Body: { name, adminEmail?, adminDisplayName?, allocatedMinutes? }
 *   Mirrors /api/admin/orgs/:id/departments POST but gated on the reseller
 *   role and an ownership check (the org must belong to the caller).
 *
 *   If admin fields are supplied, also invites a department_admin and
 *   transfers initial minutes from the enterprise pool into the new
 *   department via transfer_to_department.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor, resellerId } = gate;
  const { id: orgId } = await params;

  const { name, adminEmail, adminDisplayName, allocatedMinutes } =
    (await request.json().catch(() => ({}))) as {
      name?:             string;
      adminEmail?:       string;
      adminDisplayName?: string;
      allocatedMinutes?: number | string;
    };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Department name is required." }, { status: 400 });
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  // Ownership check: the org must belong to this reseller, and we'll
  // reuse the same row to validate against the enterprise's pool.
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, enterprise_code, status, reseller_id, remaining_minutes")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "Org not found." }, { status: 404 });
  const orgRow = org as {
    id: string; name: string; enterprise_code: string; status: string;
    reseller_id: string | null; remaining_minutes: number;
  };
  if (orgRow.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }
  if (allocNum > Number(orgRow.remaining_minutes ?? 0)) {
    return NextResponse.json(
      { error: `Allocation exceeds the enterprise's remaining minutes (${orgRow.remaining_minutes}).` },
      { status: 400 },
    );
  }

  const { data: deptRow, error: dErr } = await admin
    .from("departments")
    .insert({
      enterprise_id:      orgId,
      name:               name.trim(),
      created_by_user_id: actor.id,
    })
    .select("id, name, department_code, status, created_at")
    .single();
  if (dErr || !deptRow) {
    if ((dErr as { code?: string } | null)?.code === "23505") {
      return NextResponse.json({ error: "A department with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: dErr?.message ?? "Couldn't create department." }, { status: 400 });
  }
  const dept = deptRow as { id: string; name: string; department_code: string; status: string; created_at: string };

  // Optional: invite a department_admin if both fields are supplied.
  const inviteAdmin = adminEmail?.trim() && adminDisplayName?.trim();
  let invitedAdminId: string | null = null;
  if (inviteAdmin) {
    const trimmedEmail = adminEmail!.trim().toLowerCase();
    const invite = await sendInvitationEmail(admin, {
      email:       trimmedEmail,
      displayName: adminDisplayName!.trim(),
      metadata: {
        role_label:        "department_admin",
        organization_id:   orgId,
        org_name:          orgRow.name,
        enterprise_code:   orgRow.enterprise_code,
        department_id:     dept.id,
        department_code:   dept.department_code,
        allocated_minutes: allocNum,
        created_by:        actor.id,
      },
    });
    if (!invite.ok) {
      await admin.from("departments").delete().eq("id", dept.id);
      return NextResponse.json({ error: invite.error }, { status: 400 });
    }
    let userId = invite.userId ?? null;
    if (!userId) {
      const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)?.id ?? null;
    }
    if (!userId) {
      await admin.from("departments").delete().eq("id", dept.id);
      return NextResponse.json({ error: "Admin invited but auth row not visible." }, { status: 500 });
    }

    const { data: roleRow } = await admin
      .from("roles").select("id").eq("name", ROLE.department_admin).maybeSingle();
    const roleId = (roleRow as { id: string } | null)?.id;
    if (!roleId) {
      await admin.from("departments").delete().eq("id", dept.id);
      return NextResponse.json({ error: "department_admin role not seeded" }, { status: 500 });
    }

    const { data: currentProfile } = await admin
      .from("profiles").select("full_name, primary_role_id").eq("id", userId).maybeSingle();
    const cp = currentProfile as { full_name: string | null; primary_role_id: string | null } | null;

    await admin.from("profiles").upsert(
      {
        id:              userId,
        full_name:       cp?.full_name?.trim() ? cp.full_name : adminDisplayName!.trim(),
        primary_role_id: cp?.primary_role_id ?? roleId,
        organization_id: orgId,
        department_id:   dept.id,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );
    await admin.from("user_roles").upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
    await admin.from("departments").update({ admin_user_id: userId }).eq("id", dept.id);
    invitedAdminId = userId;
  }

  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_department", {
      _dept_id: dept.id,
      _amount:  allocNum,
    });
    if (tErr) console.warn("[reseller/orgs/departments] initial transfer failed:", tErr.message);
  }

  return NextResponse.json({
    department: {
      id:             dept.id,
      name:           dept.name,
      departmentCode: dept.department_code,
      status:         dept.status,
      createdAt:      dept.created_at,
    },
    adminUserId: invitedAdminId,
  });
}
