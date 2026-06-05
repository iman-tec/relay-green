/*
 * Add an enterprise admin to an org.
 *
 * POST /api/admin/orgs/:id/admins
 *   Body (one of):
 *     { promoteUserId }       — promote an existing member of THIS org.
 *     { email, displayName }  — invite a brand-new enterprise admin.
 *
 *   Guards:
 *     - org must exist                                             → 404
 *     - invite email already bound to a DIFFERENT enterprise       → 409
 *       (never silently moves an existing admin/member across orgs)
 *     - promote target must already belong to this org             → 404
 *
 * Companion to DELETE /api/admin/orgs/:id/admins/:userId. super_admin only.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { findUserInAnotherOrg, crossOrgError } from "@/lib/relay/orgGuard";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;
  const { id: orgId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    promoteUserId?: string;
    email?: string;
    displayName?: string;
  };

  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("id", orgId)
    .maybeSingle();
  const org = orgRow as {
    id: string;
    name: string;
    enterprise_code: string;
  } | null;
  if (!org)
    return NextResponse.json({ error: "Org not found." }, { status: 404 });

  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.enterprise_admin)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId)
    return NextResponse.json(
      { error: "enterprise_admin role not seeded" },
      { status: 500 }
    );

  let userId: string | null = null;
  let displayName = "";

  if (body.promoteUserId) {
    // Promote an existing member of THIS org. (They're already in the org,
    // so there's no cross-org move to guard against.)
    const { data: prof } = await admin
      .from("profiles")
      .select("id, organization_id, full_name")
      .eq("id", body.promoteUserId)
      .maybeSingle();
    const p = prof as {
      id: string;
      organization_id: string | null;
      full_name: string | null;
    } | null;
    if (!p || p.organization_id !== orgId) {
      return NextResponse.json({ error: "not_in_org" }, { status: 404 });
    }
    userId = p.id;
    displayName = p.full_name ?? "";
    await admin
      .from("profiles")
      .update({ primary_role_id: roleId })
      .eq("id", userId);
  } else if (body.email?.trim() && body.displayName?.trim()) {
    const trimmedEmail = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    displayName = body.displayName.trim();

    // GUARD: refuse if this email already belongs to a different enterprise.
    const guard = await findUserInAnotherOrg(admin, trimmedEmail, orgId);
    if (guard.blocked) {
      return NextResponse.json(
        { error: crossOrgError(guard.orgName) },
        { status: 409 }
      );
    }

    const invite = await sendInvitationEmail(admin, {
      email: trimmedEmail,
      displayName,
      metadata: {
        role_label: "enterprise_admin",
        organization_id: orgId,
        org_name: org.name,
        enterprise_code: org.enterprise_code,
        created_by: actor.id,
      },
    });
    if (!invite.ok)
      return NextResponse.json({ error: invite.error }, { status: 400 });

    userId = invite.userId ?? null;
    if (!userId) {
      const lookup = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      userId =
        lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)
          ?.id ?? null;
    }
    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Admin invited but auth row not yet visible — try again in a moment.",
        },
        { status: 500 }
      );
    }

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("full_name, primary_role_id")
      .eq("id", userId)
      .maybeSingle();
    const cp = existingProfile as {
      full_name: string | null;
      primary_role_id: string | null;
    } | null;

    const { error: profErr } = await admin.from("profiles").upsert(
      {
        id: userId,
        full_name: cp?.full_name?.trim() ? cp.full_name : displayName,
        primary_role_id: cp?.primary_role_id ?? roleId,
        organization_id: orgId,
        is_onboarded: true,
      },
      { onConflict: "id" }
    );
    if (profErr) {
      return NextResponse.json(
        { error: `Profile link failed: ${profErr.message}` },
        { status: 500 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "need_promote_or_invite" },
      { status: 400 }
    );
  }

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );

  return NextResponse.json({ ok: true, admin: { id: userId, displayName } });
}
