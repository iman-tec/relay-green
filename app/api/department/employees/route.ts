/*
 * Department-scoped employees — list + create.
 *
 * GET  /api/department/employees
 *   Returns the calling department admin's dept KPIs + the list of
 *   employees in that department (with auth info: email, status).
 *
 * POST /api/department/employees
 *   Body: { name, email, allocatedMinutes?, status? }  status defaults 'active'
 *   Creates an employee profile under this dept (client_type='employee',
 *   organization_id + department_id set), grants the 'client' role,
 *   transfers initial minutes via transfer_to_employee, and sends the
 *   spec-required invitation email with the department_code in metadata.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId, orgId } = gate;

  const [{ data: dept }, { data: org }, { data: profileRows }] = await Promise.all([
    admin
      .from("departments")
      .select("id, name, department_code, status, allocated_minutes, used_minutes, remaining_minutes")
      .eq("id", departmentId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("id, name, enterprise_code")
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, full_name, client_type, status, allocated_minutes, used_minutes, remaining_minutes, created_at")
      .eq("department_id", departmentId)
      // Only employees — the dept admin sits in the same department but
      // shouldn't appear in their own employees list.
      .eq("client_type", "employee"),
  ]);

  if (!dept) return NextResponse.json({ error: "department missing" }, { status: 500 });
  if (!org)  return NextResponse.json({ error: "org missing" }, { status: 500 });

  const profileIds = (profileRows ?? []).map((p: { id: string }) => p.id);
  let emails = new Map<string, string>();
  if (profileIds.length) {
    const { data: authPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = new Map(
      (authPage?.users ?? [])
        .filter((u) => u.id && profileIds.includes(u.id))
        .map((u) => [u.id, u.email ?? ""]),
    );
  }

  const d = dept as {
    id: string; name: string; department_code: string; status: string;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number;
  };
  const o = org as { id: string; name: string; enterprise_code: string };

  return NextResponse.json({
    department: {
      id:                d.id,
      name:              d.name,
      departmentCode:    d.department_code,
      status:            d.status,
      allocatedMinutes:  Number(d.allocated_minutes ?? 0),
      usedMinutes:       Number(d.used_minutes ?? 0),
      remainingMinutes:  Number(d.remaining_minutes ?? 0),
    },
    enterprise: {
      id:              o.id,
      name:            o.name,
      enterpriseCode:  o.enterprise_code,
    },
    employees: (profileRows as Array<{
      id: string; full_name: string | null; client_type: string; status: string;
      allocated_minutes: number; used_minutes: number; remaining_minutes: number; created_at: string;
    }> ?? []).map((p) => ({
      id:                p.id,
      displayName:       p.full_name ?? "",
      email:             emails.get(p.id) ?? "",
      clientType:        p.client_type,
      status:            p.status,
      allocatedMinutes:  Number(p.allocated_minutes ?? 0),
      usedMinutes:       Number(p.used_minutes ?? 0),
      remainingMinutes:  Number(p.remaining_minutes ?? 0),
      createdAt:         p.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor, departmentId, orgId } = gate;

  const { name, email, allocatedMinutes } =
    (await request.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
      allocatedMinutes?: number | string;
    };

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Need name and email." }, { status: 400 });
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  // Pre-flight: dept must be active and have enough remaining.
  const { data: deptRow } = await admin
    .from("departments")
    .select("id, name, department_code, status, remaining_minutes")
    .eq("id", departmentId)
    .maybeSingle();
  if (!deptRow) return NextResponse.json({ error: "department missing" }, { status: 500 });
  const dept = deptRow as { id: string; name: string; department_code: string; status: string; remaining_minutes: number };
  if (dept.status !== "active") {
    return NextResponse.json({ error: "Department is not active." }, { status: 403 });
  }
  if (allocNum > Number(dept.remaining_minutes ?? 0)) {
    return NextResponse.json(
      { error: `Allocation exceeds the department's remaining minutes (${dept.remaining_minutes}).` },
      { status: 400 },
    );
  }

  // Lookup enterprise (for the invite metadata).
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("id", orgId)
    .maybeSingle();
  const org = orgRow as { id: string; name: string; enterprise_code: string } | null;

  // Send invite. Employees enter the DEPARTMENT_CODE on first login;
  // template shows it under the "enter on first sign-in" label.
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
  if (!invite.ok) {
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
    return NextResponse.json(
      { error: "Employee invited but auth row not yet visible — try again in a moment." },
      { status: 500 },
    );
  }

  // Resolve client role_id (employees reuse the client surface per spec).
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.client)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    return NextResponse.json({ error: "client role not seeded" }, { status: 500 });
  }

  // Enforce 'one department per employee': if the email already belongs
  // to a profile attached to a DIFFERENT department, refuse rather than
  // silently move them.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, department_id, organization_id, full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const ep = existingProfile as {
    id: string;
    department_id: string | null;
    organization_id: string | null;
    full_name: string | null;
    primary_role_id: string | null;
  } | null;
  if (ep?.department_id && ep.department_id !== departmentId) {
    return NextResponse.json(
      { error: "This employee already belongs to another department." },
      { status: 409 },
    );
  }

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       ep?.full_name?.trim() ? ep.full_name : name.trim(),
        primary_role_id: ep?.primary_role_id ?? roleId,
        organization_id: orgId,
        department_id:   departmentId,
        client_type:     "employee",
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

  // Atomic transfer (dept pool → employee pool). RPC re-validates.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_employee", {
      _profile_id: userId,
      _amount:     allocNum,
    });
    if (tErr) {
      console.warn("[department/employees] initial transfer failed:", tErr.message);
    }
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  return NextResponse.json({
    employee: {
      id:           userId,
      displayName:  name.trim(),
      email:        trimmedEmail,
    },
    department: {
      id:             dept.id,
      departmentCode: dept.department_code,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
