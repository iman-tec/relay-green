/*
 * GET /api/enterprise/members
 *   Org-wide member roster for the enterprise admin: every employee across ALL
 *   departments, with minutes (allocated / used / remaining), spend, status
 *   (active / suspended via auth ban), department, and last activity.
 *
 *   Powers the enterprise console's org-wide Members surface — the admin owns
 *   the whole org, so this is not dept-scoped. Read-only; the per-member
 *   actions (suspend, refill, resend) live on their existing endpoints.
 *
 *   Gated on enterprise_admin, scoped to the caller's organization.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { writeAccessAudit } from "@/lib/relay/accessAudit";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CENTS_PER_MINUTE = 300; // €3.00/min list — matches the other reports.

type Profile = {
  id: string;
  full_name: string | null;
  department_id: string | null;
  client_type: string | null;
  allocated_minutes: number | null;
  used_minutes: number | null;
  remaining_minutes: number | null;
  created_at: string;
};

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  // Department id → name (for the per-member dept column).
  const { data: deptRows } = await admin
    .from("departments")
    .select("id, name")
    .eq("enterprise_id", orgId);
  const deptName = new Map<string, string>();
  for (const d of (deptRows ?? []) as { id: string; name: string }[])
    deptName.set(d.id, d.name);

  // Employees org-wide (members billed from a dept pool). The org's own admins
  // / clients are excluded — this surface manages employees across departments.
  const { data: profRows, error: profErr } = await admin
    .from("profiles")
    .select(
      "id, full_name, department_id, client_type, allocated_minutes, used_minutes, remaining_minutes, created_at"
    )
    .eq("organization_id", orgId)
    .eq("client_type", "employee")
    .order("created_at", { ascending: false });
  if (profErr)
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  const profiles = (profRows ?? []) as Profile[];
  const ids = profiles.map((p) => p.id);

  // Auth rows: email + banned + last sign-in.
  const authByUser = new Map<
    string,
    { email: string; banned: boolean; lastSignIn: string | null }
  >();
  if (ids.length) {
    const { data: authPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authPage?.users ?? []) {
      if (ids.includes(u.id)) {
        authByUser.set(u.id, {
          email: u.email ?? "",
          banned: Boolean(
            u.banned_until && new Date(u.banned_until) > new Date()
          ),
          lastSignIn: u.last_sign_in_at ?? null,
        });
      }
    }
  }

  const members = profiles.map((p) => {
    const a = authByUser.get(p.id);
    const used = Number(p.used_minutes ?? 0);
    return {
      id: p.id,
      displayName: p.full_name ?? "",
      email: a?.email ?? "",
      departmentId: p.department_id,
      departmentName: p.department_id
        ? (deptName.get(p.department_id) ?? null)
        : null,
      allocatedMinutes: Number(p.allocated_minutes ?? 0),
      usedMinutes: used,
      remainingMinutes: Number(p.remaining_minutes ?? 0),
      spendCents: Math.round(used * CENTS_PER_MINUTE),
      status: a?.banned ? "suspended" : "active",
      lastSignIn: a?.lastSignIn ?? null,
      createdAt: p.created_at,
    };
  });

  // GDPR Art. 30: record the org-wide PII read.
  void writeAccessAudit(admin, {
    actorUserId: gate.user.id,
    actorRole: ROLE.enterprise_admin,
    tenantScope: `org:${orgId}`,
    resource: "enterprise.members",
    memberIds: ids,
  });

  return NextResponse.json({
    members,
    departments: (deptRows ?? []) as { id: string; name: string }[],
  });
}
