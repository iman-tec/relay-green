/*
 * Assign a department admin to a department that currently has none.
 *
 * POST /api/enterprise/departments/:id/admin
 *   Body (one of):
 *     { promoteUserId }        — promote an existing employee of THIS dept.
 *     { email, displayName }   — invite a brand-new admin by email.
 *
 *   Fills an EMPTY admin slot only: if the department already has an
 *   admin_user_id, returns 409 (the UI hides the action in that case, but
 *   we enforce it server-side too). To change an existing admin, remove the
 *   current one first, then assign.
 *
 *   Both paths: grant department_admin role, point primary_role_id at it,
 *   keep/attach the profile to this dept + org, and set
 *   departments.admin_user_id. No minutes transfer — the department already
 *   owns its pool; assigning an admin later doesn't move minutes.
 *
 *   Caller must hold enterprise_admin and the dept must live under their org.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;
  const { id: deptId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    promoteUserId?: string;
    email?:         string;
    displayName?:   string;
  };

  // Department ownership + state guards.
  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, name, department_code, status, admin_user_id")
    .eq("id", deptId)
    .maybeSingle();
  const dept = deptRow as {
    id: string; enterprise_id: string; name: string; department_code: string;
    status: string; admin_user_id: string | null;
  } | null;
  if (!dept || dept.enterprise_id !== orgId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }
  if (dept.admin_user_id) {
    return NextResponse.json({ error: "already_has_admin" }, { status: 409 });
  }
  if (dept.status !== "active") {
    return NextResponse.json({ error: "dept_not_active" }, { status: 403 });
  }

  // department_admin role id (needed by both paths).
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.department_admin)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    return NextResponse.json({ error: "role_not_seeded" }, { status: 500 });
  }

  let userId: string | null = null;
  let displayName = "";

  if (body.promoteUserId) {
    // ── Promote an existing employee of this department ──────────────
    const { data: prof } = await admin
      .from("profiles")
      .select("id, organization_id, department_id, full_name")
      .eq("id", body.promoteUserId)
      .maybeSingle();
    const p = prof as {
      id: string; organization_id: string | null;
      department_id: string | null; full_name: string | null;
    } | null;
    if (!p || p.department_id !== deptId || p.organization_id !== orgId) {
      return NextResponse.json({ error: "not_in_department" }, { status: 404 });
    }
    userId = p.id;
    displayName = p.full_name ?? "";
    // Surface them as the dept admin (excluded from the employee list,
    // shown in the admin card). Keep department_id as-is.
    await admin
      .from("profiles")
      .update({ primary_role_id: roleId })
      .eq("id", userId);
  } else if (body.email?.trim() && body.displayName?.trim()) {
    // ── Invite a brand-new admin by email ────────────────────────────
    const trimmedEmail = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    displayName = body.displayName.trim();

    const { data: orgRow } = await admin
      .from("organizations")
      .select("name, enterprise_code")
      .eq("id", orgId)
      .maybeSingle();
    const org = orgRow as { name: string; enterprise_code: string } | null;

    const invite = await sendInvitationEmail(admin, {
      email:       trimmedEmail,
      displayName,
      metadata: {
        role_label:      "department_admin",
        organization_id: orgId,
        org_name:        org?.name,
        enterprise_code: org?.enterprise_code,
        department_id:   dept.id,
        department_code: dept.department_code,
        created_by:      actor.id,
      },
    });
    if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 400 });

    userId = invite.userId ?? null;
    if (!userId) {
      const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)?.id ?? null;
    }
    if (!userId) {
      return NextResponse.json(
        { error: "Admin invited but auth row not yet visible — try again in a moment." },
        { status: 500 },
      );
    }

    // Don't yank someone out of a different department.
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
      return NextResponse.json({ error: "user_in_other_department" }, { status: 409 });
    }

    const { error: profErr } = await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       ep?.full_name?.trim() ? ep.full_name : displayName,
          primary_role_id: roleId,
          organization_id: orgId,
          department_id:   dept.id,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );
    if (profErr) {
      return NextResponse.json({ error: `Profile link failed: ${profErr.message}` }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: "need_promote_or_invite" }, { status: 400 });
  }

  // Grant the department_admin role (idempotent).
  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );

  // Wire the dept's admin pointer.
  const { error: updErr } = await admin
    .from("departments")
    .update({ admin_user_id: userId })
    .eq("id", deptId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, admin: { id: userId, displayName } });
}
