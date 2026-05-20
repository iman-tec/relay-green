/*
 * Enterprise-scoped departments — list + create.
 *
 * GET  /api/enterprise/departments
 *   Returns the calling enterprise admin's departments with computed
 *   employee counts. Also returns the enterprise's own minute snapshot
 *   so the UI can show the parent's remaining pool.
 *
 * POST /api/enterprise/departments
 *   Body: { name, adminEmail, adminDisplayName, allocatedMinutes? }
 *   Creates the department, invites the first department_admin, grants
 *   the role, links the profile, and transfers initial minutes from
 *   the enterprise pool to the new department via transfer_to_department.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  // Enterprise self for KPIs.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, enterprise_code, status, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });
  if (!org)   return NextResponse.json({ error: "org missing" }, { status: 500 });

  // Departments under this enterprise.
  const { data: depts, error: dErr } = await admin
    .from("departments")
    .select("id, name, department_code, status, allocated_minutes, used_minutes, remaining_minutes, admin_user_id, created_at")
    .eq("enterprise_id", orgId)
    .order("created_at", { ascending: false });
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  // Employee counts per dept.
  const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
  let counts = new Map<string, { total: number; active: number }>();
  if (deptIds.length) {
    const { data: profRows } = await admin
      .from("profiles")
      .select("department_id, status")
      .in("department_id", deptIds);
    counts = new Map();
    for (const p of (profRows ?? []) as { department_id: string; status: string }[]) {
      const c = counts.get(p.department_id) ?? { total: 0, active: 0 };
      c.total += 1;
      if (p.status === "active") c.active += 1;
      counts.set(p.department_id, c);
    }
  }

  const orgRow = org as {
    id: string; name: string; enterprise_code: string; status: string;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number;
  };

  return NextResponse.json({
    enterprise: {
      id:                orgRow.id,
      name:              orgRow.name,
      enterpriseCode:    orgRow.enterprise_code,
      status:            orgRow.status,
      allocatedMinutes:  Number(orgRow.allocated_minutes ?? 0),
      usedMinutes:       Number(orgRow.used_minutes ?? 0),
      remainingMinutes:  Number(orgRow.remaining_minutes ?? 0),
    },
    departments: (depts as Array<{
      id: string; name: string; department_code: string; status: string;
      allocated_minutes: number; used_minutes: number; remaining_minutes: number;
      admin_user_id: string | null; created_at: string;
    }>).map((d) => ({
      id:                d.id,
      name:              d.name,
      departmentCode:    d.department_code,
      status:            d.status,
      allocatedMinutes:  Number(d.allocated_minutes ?? 0),
      usedMinutes:       Number(d.used_minutes ?? 0),
      remainingMinutes:  Number(d.remaining_minutes ?? 0),
      adminUserId:       d.admin_user_id,
      totalEmployees:    counts.get(d.id)?.total ?? 0,
      activeEmployees:   counts.get(d.id)?.active ?? 0,
      createdAt:         d.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor, orgId } = gate;

  const { name, adminEmail, adminDisplayName, allocatedMinutes } =
    (await request.json().catch(() => ({}))) as {
      name?: string;
      adminEmail?: string;
      adminDisplayName?: string;
      allocatedMinutes?: number | string;
    };

  if (!name?.trim() || !adminEmail?.trim() || !adminDisplayName?.trim()) {
    return NextResponse.json(
      { error: "Need name, adminEmail, and adminDisplayName." },
      { status: 400 },
    );
  }
  const trimmedEmail = adminEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid admin email." }, { status: 400 });
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  // Pre-flight: confirm the org has enough remaining_minutes and is active.
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, enterprise_code, status, remaining_minutes")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "org missing" }, { status: 500 });
  const orgRow = org as { id: string; name: string; enterprise_code: string; status: string; remaining_minutes: number };
  if (orgRow.status !== "active") {
    return NextResponse.json({ error: "Enterprise is not active." }, { status: 403 });
  }
  if (allocNum > Number(orgRow.remaining_minutes ?? 0)) {
    return NextResponse.json(
      { error: `Allocation exceeds the enterprise's remaining minutes (${orgRow.remaining_minutes}).` },
      { status: 400 },
    );
  }

  // Create department. The set-code trigger fills department_code in
  // DLC- format. UNIQUE(enterprise_id, name) catches dupes; 23505 → 409.
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

  // Invite the department admin. Spec: invite email shows the enterprise
  // code (which the admin enters on first login) + the department code.
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: adminDisplayName.trim(),
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
    userId = lookup.data?.users?.find(
      (u) => u.email?.toLowerCase() === trimmedEmail,
    )?.id ?? null;
  }
  if (!userId) {
    await admin.from("departments").delete().eq("id", dept.id);
    return NextResponse.json(
      { error: "Admin invited but auth row not yet visible — try again in a moment." },
      { status: 500 },
    );
  }

  // Grant department_admin role and link profile to org + dept.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.department_admin)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    await admin.from("departments").delete().eq("id", dept.id);
    return NextResponse.json({ error: "department_admin role not seeded" }, { status: 500 });
  }

  const { data: currentProfile } = await admin
    .from("profiles")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const cp = currentProfile as { full_name: string | null; primary_role_id: string | null } | null;

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       cp?.full_name?.trim() ? cp.full_name : adminDisplayName.trim(),
        primary_role_id: cp?.primary_role_id ?? roleId,
        organization_id: orgId,
        department_id:   dept.id,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );

  // Wire the dept's admin_user_id back to the new admin.
  await admin
    .from("departments")
    .update({ admin_user_id: userId })
    .eq("id", dept.id);

  // Atomic transfer (enterprise pool → dept pool). RPC re-validates.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_department", {
      _dept_id: dept.id,
      _amount:  allocNum,
    });
    if (tErr) {
      console.warn("[enterprise/departments] initial transfer failed:", tErr.message);
    }
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  return NextResponse.json({
    department: {
      id:             dept.id,
      name:           dept.name,
      departmentCode: dept.department_code,
      status:         dept.status,
      createdAt:      dept.created_at,
    },
    admin: {
      id:          userId,
      email:       trimmedEmail,
      displayName: adminDisplayName.trim(),
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
