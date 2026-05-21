/*
 * GET /api/reseller/orgs/:id/departments/:deptId/employees
 *   Read-only: lists employees in a department, plus the department admin
 *   (split out so the UI can show them in their own card).
 *
 *   Ownership check: org must belong to the calling reseller AND department
 *   must belong to that org. Mirrors the read shape of
 *   /api/admin/orgs/:id/departments/:deptId/employees so the redesigned
 *   reseller panel can reuse the same row renderers.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;
  const { id: orgId, deptId } = await params;

  // Defence-in-depth: confirm the org belongs to this reseller before we
  // expose anything inside it.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  const org = orgRow as { id: string; reseller_id: string | null } | null;
  if (!org || org.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

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

  const { data: profRows, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
    .eq("department_id", deptId)
    .order("created_at", { ascending: false });
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  type Profile = {
    id: string; full_name: string | null; primary_role_id: string | null;
    allocated_minutes: number | null; used_minutes: number | null; remaining_minutes: number | null;
    client_type: string | null; created_at: string;
  };
  const profiles = (profRows ?? []) as Profile[];

  const roleIds = Array.from(new Set(
    profiles.map((p) => p.primary_role_id).filter((id): id is string => !!id),
  ));
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
        email:      u.email ?? "",
        banned:     Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
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
      status:           a?.banned ? "suspended" : "active",
      lastSignIn:       a?.lastSignIn,
      createdAt:        p.created_at,
    };
  };

  let adminProfile: Profile | null = dept.admin_user_id
    ? profiles.find((p) => p.id === dept.admin_user_id) ?? null
    : null;
  if (dept.admin_user_id && !adminProfile) {
    const { data: extraProfile } = await admin
      .from("profiles")
      .select("id, full_name, primary_role_id, allocated_minutes, used_minutes, remaining_minutes, client_type, created_at")
      .eq("id", dept.admin_user_id)
      .maybeSingle();
    adminProfile = (extraProfile as Profile | null) ?? null;
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
