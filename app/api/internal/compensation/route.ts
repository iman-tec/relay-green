/*
 * Org compensation API for enterprise + department admins. Lists staff in
 * the caller's org alongside their monthly salary and lets the caller
 * upsert a salary.
 *
 * GET  /api/internal/compensation
 *   Returns: { currency, staff: [{ userId, displayName, email, role, monthlyCents, updatedAt }] }
 *
 * PUT  /api/internal/compensation
 *   Body: { userId, monthlyCents }
 *   Upserts compensation row for the target user under the caller's org.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Roles whose members appear on the org's payroll roster. Mirrors the
// pre-reshape set after the 1:1 role mapping (engineer, pod_lead → supervisor,
// ops_manager → department_admin, admin + enterprise_admin → enterprise_admin).
const PAYROLL_ROLES: readonly string[] = [
  ROLE.engineer,
  ROLE.supervisor,
  ROLE.department_admin,
  ROLE.enterprise_admin,
];

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data: org } = await admin
    .from("organizations")
    .select("billing_currency")
    .eq("id", orgId)
    .single();
  const currency =
    (org as { billing_currency?: string } | null)?.billing_currency ?? "EUR";

  const { data: profiles } = await admin
    .from("profiles_with_role")
    .select("id, full_name, primary_role")
    .eq("organization_id", orgId);

  const userIds = (profiles ?? []).map((p: { id: string }) => p.id);
  if (userIds.length === 0) {
    return NextResponse.json({ currency, staff: [] });
  }

  const [{ data: roles }, { data: comp }, { data: authUsers }] =
    await Promise.all([
      admin
        .from("user_role_names")
        .select("user_id, role")
        .in("user_id", userIds),
      admin
        .from("org_compensation")
        .select("user_id, monthly_cents, updated_at")
        .eq("organization_id", orgId),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);

  const emailById = new Map<string, string>();
  for (const u of authUsers?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const rolesByUser = new Map<string, string[]>();
  for (const r of (roles ?? []) as { user_id: string; role: string }[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  }

  const compByUser = new Map<
    string,
    { monthly_cents: number; updated_at: string }
  >();
  for (const c of (comp ?? []) as {
    user_id: string;
    monthly_cents: number;
    updated_at: string;
  }[]) {
    compByUser.set(c.user_id, {
      monthly_cents: c.monthly_cents,
      updated_at: c.updated_at,
    });
  }

  const staff = (profiles ?? [])
    .map(
      (p: {
        id: string;
        full_name: string | null;
        primary_role: string | null;
      }) => {
        const userRoles = rolesByUser.get(p.id) ?? [];
        const onPayroll = userRoles.some((r) => PAYROLL_ROLES.includes(r));
        if (!onPayroll) return null;
        const c = compByUser.get(p.id);
        return {
          userId: p.id,
          displayName: p.full_name ?? "Unnamed",
          email: emailById.get(p.id) ?? "",
          role: p.primary_role ?? userRoles[0] ?? "—",
          monthlyCents: c?.monthly_cents ?? 0,
          updatedAt: c?.updated_at ?? null,
        };
      }
    )
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Stable ordering: enterprise-side admins first, then platform-side
  // overseers, then engineers, then alphabetic.
  const roleRank: Record<string, number> = {
    [ROLE.enterprise_admin]: 0,
    [ROLE.department_admin]: 1,
    [ROLE.supervisor]: 2,
    [ROLE.engineer]: 3,
  };
  staff.sort((a, b) => {
    const ra = roleRank[a.role] ?? 99;
    const rb = roleRank[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });

  return NextResponse.json({ currency, staff });
}

export async function PUT(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user } = gate;

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    monthlyCents?: number;
  } | null;
  if (
    !body?.userId ||
    typeof body.monthlyCents !== "number" ||
    body.monthlyCents < 0
  ) {
    return NextResponse.json(
      { error: "Need userId and non-negative monthlyCents." },
      { status: 400 }
    );
  }

  // Make sure the target user belongs to the caller's org.
  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", body.userId)
    .maybeSingle();
  if (
    !target ||
    (target as { organization_id?: string }).organization_id !== orgId
  ) {
    return NextResponse.json({ error: "user_not_in_org" }, { status: 403 });
  }

  const { data: org } = await admin
    .from("organizations")
    .select("billing_currency")
    .eq("id", orgId)
    .single();
  const currency =
    (org as { billing_currency?: string } | null)?.billing_currency ?? "EUR";

  const { error: upErr } = await admin.from("org_compensation").upsert(
    {
      organization_id: orgId,
      user_id: body.userId,
      monthly_cents: Math.round(body.monthlyCents),
      currency,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" }
  );

  if (upErr)
    return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
