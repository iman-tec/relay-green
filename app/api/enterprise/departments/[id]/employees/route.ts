/*
 * Enterprise-scoped employees list + create — mirrors
 * /api/admin/orgs/:id/departments/:deptId/employees but gated on
 * enterprise_admin (and scoped to the caller's own org).
 *
 * GET  /api/enterprise/departments/:id/employees
 *   Lists employees + the dept admin under :id. Verifies the dept lives
 *   under the caller's org.
 *
 * POST /api/enterprise/departments/:id/employees
 *   Body: { name, email, allocatedMinutes? }
 *   Invites an employee + links to dept + transfers initial minutes from
 *   dept pool. Re-uses sendInvitationEmail + transfer_to_employee.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { findUserInAnotherOrg, crossOrgError } from "@/lib/relay/orgGuard";
import { writeAccessAudit } from "@/lib/relay/accessAudit";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

type Profile = {
  id: string; full_name: string | null; primary_role_id: string | null;
  allocated_minutes: number | null; used_minutes: number | null; remaining_minutes: number | null;
  client_type: string | null; created_at: string;
};

export async function GET(_request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;
  const { id: deptId } = await params;

  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, name, department_code, admin_user_id, allocated_minutes, used_minutes, remaining_minutes, status")
    .eq("id", deptId)
    .maybeSingle();
  const dept = deptRow as {
    id: string; enterprise_id: string; name: string; department_code: string;
    admin_user_id: string | null;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number; status: string;
  } | null;
  if (!dept || dept.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in your org." }, { status: 404 });
  }

  // Query `profiles` directly — see admin-side route for why
  // (profiles_with_role view doesn't expose department_id/client_type).
  const { data: profRows, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
    .eq("department_id", deptId)
    .order("created_at", { ascending: false });
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  const profiles = (profRows ?? []) as Profile[];

  const roleIds = Array.from(new Set(profiles.map((p) => p.primary_role_id).filter((x): x is string => !!x)));
  const roleNameById = new Map<string, string>();
  if (roleIds.length) {
    const { data: rs } = await admin.from("roles").select("id, name").in("id", roleIds);
    for (const r of (rs ?? []) as { id: string; name: string }[]) roleNameById.set(r.id, r.name);
  }

  const profileIds = profiles.map((p) => p.id);
  const authByUser = new Map<string, { email: string; banned: boolean; lastSignIn: string | null }>();
  if (profileIds.length) {
    const { data: authPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of authPage?.users ?? []) {
      if (profileIds.includes(u.id)) {
        authByUser.set(u.id, {
          email:      u.email ?? "",
          banned:     Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
          lastSignIn: u.last_sign_in_at ?? null,
        });
      }
    }
  }

  const toRow = (p: Profile) => {
    const a = authByUser.get(p.id);
    return {
      id:               p.id,
      displayName:      p.full_name ?? "",
      email:            a?.email ?? "",
      primaryRole:      p.primary_role_id ? (roleNameById.get(p.primary_role_id) ?? null) : null,
      clientType:       p.client_type ?? "client",
      allocatedMinutes: Number(p.allocated_minutes ?? 0),
      usedMinutes:      Number(p.used_minutes ?? 0),
      remainingMinutes: Number(p.remaining_minutes ?? 0),
      status:           a?.banned ? "suspended" : "active",
      lastSignIn:       a?.lastSignIn,
      createdAt:        p.created_at,
    };
  };

  let adminProfile: Profile | null = dept.admin_user_id
    ? profiles.find((p) => p.id === dept.admin_user_id) ?? null
    : null;
  if (dept.admin_user_id && !adminProfile) {
    const { data: extra } = await admin
      .from("profiles")
      .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
      .eq("id", dept.admin_user_id)
      .maybeSingle();
    adminProfile = (extra as Profile | null) ?? null;
    if (adminProfile && !authByUser.has(adminProfile.id)) {
      const { data: u } = await admin.auth.admin.getUserById(adminProfile.id);
      if (u?.user) {
        authByUser.set(adminProfile.id, {
          email:      u.user.email ?? "",
          banned:     Boolean(u.user.banned_until && new Date(u.user.banned_until) > new Date()),
          lastSignIn: u.user.last_sign_in_at ?? null,
        });
      }
    }
  }
  const employees = profiles.filter((p) => p.id !== dept.admin_user_id).map(toRow);

  // GDPR Art. 30: record that an org admin read these members' PII.
  void writeAccessAudit(admin, {
    actorUserId: gate.user.id,
    actorRole:   ROLE.enterprise_admin,
    tenantScope: `org:${orgId}`,
    resource:    "enterprise.department.employees",
    memberIds:   profiles.map((p) => p.id),
  });

  return NextResponse.json({
    department: {
      id:               dept.id,
      name:             dept.name,
      departmentCode:   dept.department_code,
      status:           dept.status,
      allocatedMinutes: Number(dept.allocated_minutes ?? 0),
      usedMinutes:      Number(dept.used_minutes ?? 0),
      remainingMinutes: Number(dept.remaining_minutes ?? 0),
    },
    admin:     adminProfile ? toRow(adminProfile) : null,
    employees,
  });
}

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;
  const { id: deptId } = await params;

  const { name, email, allocatedMinutes } = (await request.json().catch(() => ({}))) as {
    name?: string; email?: string; allocatedMinutes?: number | string;
  };
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Need name and email." }, { status: 400 });
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  // GUARD: don't pull in an email already bound to another enterprise.
  {
    const guard = await findUserInAnotherOrg(admin, trimmedEmail, orgId);
    if (guard.blocked) {
      return NextResponse.json({ error: crossOrgError(guard.orgName) }, { status: 409 });
    }
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, name, department_code, status, remaining_minutes")
    .eq("id", deptId).maybeSingle();
  const dept = deptRow as {
    id: string; enterprise_id: string; name: string; department_code: string;
    status: string; remaining_minutes: number;
  } | null;
  if (!dept || dept.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in your org." }, { status: 404 });
  }
  if (dept.status !== "active") {
    return NextResponse.json({ error: "Department is not active." }, { status: 403 });
  }
  if (allocNum > Number(dept.remaining_minutes ?? 0)) {
    return NextResponse.json(
      { error: `Allocation exceeds the department's remaining minutes (${dept.remaining_minutes}).` },
      { status: 400 },
    );
  }

  const { data: orgRow } = await admin
    .from("organizations").select("id, name, enterprise_code").eq("id", orgId).maybeSingle();
  const org = orgRow as { id: string; name: string; enterprise_code: string } | null;

  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: name.trim(),
    metadata: {
      role_label:        "employee",
      organization_id:   orgId,
      org_name:          org?.name,
      enterprise_code:   org?.enterprise_code,
      department_id:     dept.id,
      department_code:   dept.department_code,
      allocated_minutes: allocNum,
      created_by:        actor.id,
    },
  });
  if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 400 });

  let userId = invite.userId ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "Employee invited but auth row not visible. Try again." }, { status: 500 },
    );
  }

  const { data: roleRow } = await admin.from("roles").select("id").eq("name", ROLE.client).maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) return NextResponse.json({ error: "client role not seeded" }, { status: 500 });

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, department_id, full_name, primary_role_id")
    .eq("id", userId).maybeSingle();
  const ep = existingProfile as {
    id: string; department_id: string | null;
    full_name: string | null; primary_role_id: string | null;
  } | null;
  if (ep?.department_id && ep.department_id !== deptId) {
    return NextResponse.json(
      { error: "This employee already belongs to another department." }, { status: 409 },
    );
  }

  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id:              userId,
      full_name:       ep?.full_name?.trim() ? ep.full_name : name.trim(),
      primary_role_id: ep?.primary_role_id ?? roleId,
      organization_id: orgId,
      department_id:   deptId,
      client_type:     "employee",
      is_onboarded:    true,
    },
    { onConflict: "id" },
  );
  if (profErr) {
    return NextResponse.json({ error: `Profile link failed: ${profErr.message}` }, { status: 500 });
  }
  await admin.from("user_roles").upsert(
    { user_id: userId, role_id: roleId },
    { onConflict: "user_id,role_id", ignoreDuplicates: true },
  );

  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_employee", {
      _profile_id: userId, _amount: allocNum,
    });
    if (tErr) console.warn("[enterprise/departments/employees] initial transfer failed:", tErr.message);
  }

  return NextResponse.json({
    employee: { id: userId, displayName: name.trim(), email: trimmedEmail },
  });
}
