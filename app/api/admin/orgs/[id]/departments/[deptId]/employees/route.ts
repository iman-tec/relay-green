/*
 * GET  /api/admin/orgs/:id/departments/:deptId/employees
 *   Lists employees under a department with auth email + status + minutes.
 *
 * POST /api/admin/orgs/:id/departments/:deptId/employees
 *   Body: { name, email, allocatedMinutes? }
 *   Invites an employee, links to dept, transfers minutes from dept pool.
 *   Mirrors /api/department/employees POST but with a super_admin gate.
 *
 * Caller must hold super_admin. :id (org) must match the dept's enterprise_id.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { findUserInAnotherOrg, crossOrgError } from "@/lib/relay/orgGuard";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id: orgId, deptId } = await params;

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
    return NextResponse.json({ error: "Department not found in this org." }, { status: 404 });
  }

  // Query `profiles` directly. The `profiles_with_role` view was created
  // before `department_id` / `client_type` were added to `profiles`, and
  // Postgres views don't expand `SELECT *` retroactively — so filtering
  // on those columns through the view silently returns 0 rows.
  const { data: profRows, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
    .eq("department_id", deptId)
    .order("created_at", { ascending: false });
  if (profErr) {
    console.error("[admin/orgs/departments/employees] profiles read failed:", profErr);
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  type Profile = {
    id: string; full_name: string | null; primary_role_id: string | null;
    allocated_minutes: number | null; used_minutes: number | null; remaining_minutes: number | null;
    client_type: string | null; created_at: string;
  };
  const profiles = (profRows ?? []) as Profile[];

  // Resolve role names for the profiles we found (only needed if a row
  // has a primary_role_id; most employees will be `client`).
  const roleIds = Array.from(new Set(profiles.map((p) => p.primary_role_id).filter((id): id is string => !!id)));
  const roleNameById = new Map<string, string>();
  if (roleIds.length) {
    const { data: roleRows } = await admin
      .from("roles").select("id, name").in("id", roleIds);
    for (const r of (roleRows ?? []) as { id: string; name: string }[]) {
      roleNameById.set(r.id, r.name);
    }
  }

  const { data: authPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authByUser = new Map(
    (authPage?.users ?? []).map((u) => [
      u.id,
      {
        email:    u.email ?? "",
        banned:   Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
        lastSignIn: u.last_sign_in_at ?? null,
      },
    ]),
  );

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
      // Lifecycle, not presence: banned → suspended; never-signed-in (invited
      // but not accepted) → invited; otherwise active. email_confirmed_at is
      // set at invite time so it can't distinguish accepted from pending —
      // last_sign_in_at is the real "they've accepted" signal.
      status:           a?.banned ? "suspended" : (a?.lastSignIn ? "active" : "invited"),
      lastSignIn:       a?.lastSignIn,
      createdAt:        p.created_at,
    };
  };

  // Split the department admin out so the UI can render them as a
  // separate card above the employees table.
  let adminProfile: Profile | null = dept.admin_user_id
    ? profiles.find((p) => p.id === dept.admin_user_id) ?? null
    : null;
  // If the admin's profile isn't department-bound (e.g. a super_admin
  // appointed as dept admin without department_id being set), fetch it
  // and the corresponding auth row separately so we can still surface them.
  if (dept.admin_user_id && !adminProfile) {
    const { data: extraProfile } = await admin
      .from("profiles")
      .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
      .eq("id", dept.admin_user_id)
      .maybeSingle();
    adminProfile = (extraProfile as Profile | null) ?? null;
    if (adminProfile && !authByUser.has(adminProfile.id)) {
      // Best-effort: do a per-id lookup so the admin's email shows up.
      const { data: u } = await admin.auth.admin.getUserById(adminProfile.id);
      if (u?.user) {
        authByUser.set(adminProfile.id, {
          email:      u.user.email ?? "",
          banned:     Boolean(u.user.banned_until && new Date(u.user.banned_until) > new Date()),
          lastSignIn: u.user.last_sign_in_at ?? null,
        });
      }
    }
    if (adminProfile && adminProfile.primary_role_id && !roleNameById.has(adminProfile.primary_role_id)) {
      const { data: rr } = await admin
        .from("roles").select("id, name").eq("id", adminProfile.primary_role_id).maybeSingle();
      const r = rr as { id: string; name: string } | null;
      if (r) roleNameById.set(r.id, r.name);
    }
  }
  const employees = profiles
    .filter((p) => p.id !== dept.admin_user_id)
    .map(toRow);

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
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;
  const { id: orgId, deptId } = await params;

  const { name, email, allocatedMinutes } = (await request.json().catch(() => ({}))) as {
    name?:             string;
    email?:            string;
    allocatedMinutes?: number | string;
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
    .eq("id", deptId)
    .maybeSingle();
  const dept = deptRow as {
    id: string; enterprise_id: string; name: string; department_code: string;
    status: string; remaining_minutes: number;
  } | null;
  if (!dept || dept.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in this org." }, { status: 404 });
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
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("id", orgId)
    .maybeSingle();
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
      { error: "Employee invited but auth row not yet visible — try again." },
      { status: 500 },
    );
  }

  const { data: roleRow } = await admin
    .from("roles").select("id").eq("name", ROLE.client).maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) return NextResponse.json({ error: "client role not seeded" }, { status: 500 });

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, department_id, full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const ep = existingProfile as {
    id: string; department_id: string | null;
    full_name: string | null; primary_role_id: string | null;
  } | null;
  if (ep?.department_id && ep.department_id !== deptId) {
    return NextResponse.json(
      { error: "This employee already belongs to another department." },
      { status: 409 },
    );
  }

  const { error: profileErr } = await admin.from("profiles").upsert(
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
  if (profileErr) {
    console.error("[admin/orgs/departments/employees] profile upsert failed:", profileErr);
    return NextResponse.json({ error: `Profile link failed: ${profileErr.message}` }, { status: 500 });
  }

  // Verify the link actually took. Defends against an auto-trigger
  // overwriting our values right after the upsert.
  const { data: verifyRow } = await admin
    .from("profiles")
    .select("department_id, organization_id, client_type")
    .eq("id", userId)
    .maybeSingle();
  const v = verifyRow as {
    department_id: string | null;
    organization_id: string | null;
    client_type: string | null;
  } | null;
  if (!v || v.department_id !== deptId || v.organization_id !== orgId || v.client_type !== "employee") {
    console.error("[admin/orgs/departments/employees] verify failed:", v);
    return NextResponse.json(
      { error: `Profile link didn't stick — department_id=${v?.department_id} organization_id=${v?.organization_id} client_type=${v?.client_type}` },
      { status: 500 },
    );
  }

  const { error: roleErr } = await admin.from("user_roles").upsert(
    { user_id: userId, role_id: roleId },
    { onConflict: "user_id,role_id", ignoreDuplicates: true },
  );
  if (roleErr) {
    console.warn("[admin/orgs/departments/employees] role upsert failed:", roleErr.message);
  }

  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_employee", {
      _profile_id: userId,
      _amount:     allocNum,
    });
    if (tErr) console.warn("[admin/orgs/departments/employees] initial transfer failed:", tErr.message);
  }

  return NextResponse.json({
    employee: { id: userId, displayName: name.trim(), email: trimmedEmail },
  });
}
