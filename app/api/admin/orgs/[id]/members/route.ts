/*
 * POST /api/admin/orgs/:id/members
 *   Invite a user under an existing org. The caller picks the role:
 *     - 'enterprise_admin' → another Enterprise Admin alongside the first one
 *     - 'client'           → a customer user under that org
 *
 *   Super Admin uses this both for real onboarding and for end-to-end
 *   testing without depending on the actual enterprise contact.
 *
 *   Body: { email, displayName, role?: 'enterprise_admin' | 'client' }
 *         role defaults to 'client' for backwards compat.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ORG_MEMBER_ROLES: ReadonlySet<string> = new Set([
  ROLE.enterprise_admin,
  ROLE.client,
]);

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { id: orgId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    displayName?: string;
    role?: string;
  };
  const email       = body.email?.trim();
  const displayName = body.displayName?.trim();
  const role        = body.role && ORG_MEMBER_ROLES.has(body.role) ? body.role : ROLE.client;

  if (!email || !displayName) {
    return NextResponse.json(
      { error: "Need email and displayName." },
      { status: 400 },
    );
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) {
    return NextResponse.json({ error: "Org not found." }, { status: 404 });
  }

  const trimmedEmail = email.toLowerCase();

  // Unified invite — picks inviteUserByEmail or signInWithOtp under the
  // hood. Either way, an actual email is delivered, or we return an error.
  // Enterprise admins get the enterprise_code so the new template can
  // show it; clients don't need a code.
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName,
    metadata: {
      role_label:      role,
      organization_id: orgId,
      org_name:        org.name,
      ...(role === ROLE.enterprise_admin
        ? { enterprise_code: (org as { enterprise_code: string }).enterprise_code }
        : {}),
      created_by:      actor.id,
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
      { error: "Member invited but auth row not yet visible — try again." },
      { status: 500 },
    );
  }

  // Resolve role_id for the target role once.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    return NextResponse.json({ error: `Unknown role: ${role}` }, { status: 500 });
  }

  // Don't clobber primary_role for existing users (e.g. a super_admin
  // attached to a test org should stay super_admin). Refresh full_name
  // only if it was blank.
  const { data: currentProfile } = await admin
    .from("profiles_with_role")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const cp = currentProfile as { full_name: string | null; primary_role_id: string | null } | null;

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       cp?.full_name?.trim() ? cp.full_name : displayName,
        primary_role_id: cp?.primary_role_id ?? roleId,
        organization_id: orgId,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );

  console.log(
    `[admin/orgs/${orgId}/members] ${mode} ${trimmedEmail} (${role})`,
  );

  return NextResponse.json({
    member: {
      id:          userId,
      email:       trimmedEmail,
      displayName,
      role,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
