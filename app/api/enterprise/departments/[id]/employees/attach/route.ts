/*
 * POST /api/enterprise/departments/:id/employees/attach
 *   Body: { email: string }
 *   Attach an EXISTING user to this department as an employee — no fresh invite.
 *   Use when the person already has a Relay account (an org client, or a member
 *   not yet in a department). Sets organization_id + department_id +
 *   client_type='employee' and grants the `client` role if missing. Minutes are
 *   untouched (refill afterwards); money-safe.
 *
 *   Guards: dept in caller's org; user exists; user not already in ANOTHER org.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id: deptId } = await params;
  const { email } = (await request.json().catch(() => ({}))) as {
    email?: string;
  };
  const wanted = email?.trim().toLowerCase();
  if (!deptId || !wanted) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Dept must live under the caller's org.
  const { data: dept } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", deptId)
    .maybeSingle();
  if (!dept || (dept as { enterprise_id: string }).enterprise_id !== orgId) {
    return NextResponse.json({ error: "dept_not_in_org" }, { status: 404 });
  }

  // Find the existing auth user by email.
  const { data: page } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const authUser = (page?.users ?? []).find(
    (u) => u.email?.toLowerCase() === wanted
  );
  if (!authUser) {
    return NextResponse.json(
      { error: "No existing Relay user with that email — use Invite instead." },
      { status: 404 }
    );
  }

  // Their profile must not already belong to a DIFFERENT org.
  const { data: prof } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", authUser.id)
    .maybeSingle();
  const existingOrg = (prof as { organization_id: string | null } | null)
    ?.organization_id;
  if (existingOrg && existingOrg !== orgId) {
    return NextResponse.json(
      { error: "That user already belongs to another organization." },
      { status: 409 }
    );
  }

  // Resolve the `client` role id.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.client)
    .maybeSingle();
  const clientRoleId = (roleRow as { id: string } | null)?.id;

  // Attach to org + dept as an employee.
  const { error: upErr } = await admin.from("profiles").upsert(
    {
      id: authUser.id,
      organization_id: orgId,
      department_id: deptId,
      client_type: "employee",
      is_onboarded: true,
      ...(clientRoleId && !prof ? { primary_role_id: clientRoleId } : {}),
    },
    { onConflict: "id" }
  );
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (clientRoleId) {
    await admin
      .from("user_roles")
      .upsert(
        { user_id: authUser.id, role_id: clientRoleId },
        { onConflict: "user_id,role_id", ignoreDuplicates: true }
      );
  }

  return NextResponse.json({
    ok: true,
    member: { id: authUser.id, email: authUser.email ?? wanted },
  });
}
