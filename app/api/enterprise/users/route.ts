/*
 * Enterprise admin's user-management API — list + invite, scoped to
 * the caller's organization_id.
 *
 * GET  /api/enterprise/users?scope=staff|users
 *   Lists profiles in the caller's org, split by role. Staff = anyone
 *   holding a staff role (anything except `client`); users = everyone
 *   else under the same org.
 *
 * POST /api/enterprise/users
 *   Body: { email, displayName, role: 'manager' | 'member' }
 *   Invites a new user, locking them to the caller's organization_id.
 *   role maps to:
 *     manager → enterprise_admin (peer admin inside the org)
 *     member  → client           (regular end-user employee)
 *
 *   The previous 'analyst' tier (read-only org analytics) was retired in
 *   the role taxonomy reshape — there's no clean equivalent yet.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE, STAFF_ROLES as ALL_STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ENT_ROLE_TO_USER_ROLE: Record<string, string> = {
  manager: ROLE.enterprise_admin,
  member:  ROLE.client,
};

const STAFF_ROLE_SET: ReadonlySet<string> = new Set(ALL_STAFF_ROLES);

export async function GET(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "users";
  if (scope !== "staff" && scope !== "users") {
    return NextResponse.json({ error: "scope must be 'staff' or 'users'." }, { status: 400 });
  }

  const { data: profiles } = await admin
    .from("profiles_with_role")
    .select("id, full_name, primary_role, is_onboarded, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const list = (profiles ?? []) as Array<{
    id: string; full_name: string | null; primary_role: string | null;
    is_onboarded: boolean | null; created_at: string;
  }>;
  if (list.length === 0) return NextResponse.json({ members: [] });

  const profileIds = list.map((p) => p.id);
  const { data: roleRows } = await admin
    .from("user_role_names")
    .select("user_id, role")
    .in("user_id", profileIds);
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Set());
    rolesByUser.get(r.user_id)!.add(r.role);
  }

  const { data: authPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authByUser = new Map<string, { email: string; lastSignIn: string | null; confirmed: boolean }>();
  for (const u of authPage?.users ?? []) {
    if (profileIds.includes(u.id)) {
      authByUser.set(u.id, {
        email:       u.email ?? "",
        lastSignIn:  u.last_sign_in_at ?? null,
        confirmed:   Boolean(u.email_confirmed_at),
      });
    }
  }

  const members = list
    .map((p) => {
      const rolesForUser = rolesByUser.get(p.id) ?? new Set<string>();
      const isStaff = Array.from(rolesForUser).some((r) => STAFF_ROLE_SET.has(r));
      const auth = authByUser.get(p.id);
      return {
        id:          p.id,
        displayName: p.full_name ?? "",
        email:       auth?.email ?? "",
        roles:       Array.from(rolesForUser),
        primaryRole: p.primary_role ?? "",
        isStaff,
        status:      auth?.confirmed ? "active" : "pending",
        lastSignIn:  auth?.lastSignIn,
        createdAt:   p.created_at,
      };
    })
    .filter((m) => (scope === "staff" ? m.isStaff : !m.isStaff));

  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  const { email, displayName, role } =
    (await request.json().catch(() => ({}))) as {
      email?: string; displayName?: string; role?: string;
    };

  if (!email?.trim() || !displayName?.trim() || !role || !ENT_ROLE_TO_USER_ROLE[role]) {
    return NextResponse.json(
      { error: "Need email, displayName, and role ∈ {manager, member}." },
      { status: 400 },
    );
  }
  const mappedRole = ENT_ROLE_TO_USER_ROLE[role];

  // Fetch the org so we can include its name + code in the invite email.
  const { data: org } = await admin
    .from("organizations")
    .select("name, enterprise_code")
    .eq("id", orgId)
    .single();

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName  = displayName.trim();

  // Cross-org guard for existing users — must come BEFORE the invite so
  // we don't send a misleading email if we're going to reject anyway.
  const lookup0 = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing0 = lookup0.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail);
  if (existing0) {
    const { data: prior } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", existing0.id)
      .maybeSingle();
    const otherOrg = (prior as { organization_id: string | null } | null)?.organization_id;
    if (otherOrg && otherOrg !== orgId) {
      return NextResponse.json(
        { error: "This user already belongs to another organization. Ask a super admin to release them first." },
        { status: 409 },
      );
    }
  }

  // Unified invite (inviteUserByEmail → signInWithOtp fallback). Always
  // sends an email (or returns an error).
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: trimmedName,
    metadata: {
      role_label:      role,        // ent-facing: manager/analyst/member
      mapped_role:     mappedRole,  // backend role
      organization_id: orgId,
      org_name:        org?.name ?? "",
      enterprise_code: org?.enterprise_code ?? "",
      invited_by:      actor.id,
    },
  });
  if (!invite.ok) {
    return NextResponse.json({ error: invite.error }, { status: 400 });
  }

  let userId = invite.userId ?? existing0?.id ?? null;
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

  // Resolve role_id for the mapped role.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", mappedRole)
    .maybeSingle();
  const mappedRoleId = (roleRow as { id: string } | null)?.id;
  if (!mappedRoleId) {
    return NextResponse.json({ error: `Unknown role: ${mappedRole}` }, { status: 500 });
  }

  // Profile upsert: bind to this org, preserve existing primary_role +
  // name if already set.
  const { data: prior2 } = await admin
    .from("profiles_with_role")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const p = prior2 as { full_name: string | null; primary_role_id: string | null } | null;

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       p?.full_name?.trim() ? p.full_name : trimmedName,
        primary_role_id: p?.primary_role_id ?? mappedRoleId,
        organization_id: orgId,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: mappedRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
  if (roleErr) {
    if (mode === "invited") {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  console.log(
    `[enterprise/users] org=${orgId} ${mode} ${trimmedEmail} as ${role}/${mappedRole}`,
  );

  return NextResponse.json({
    user: {
      id:          userId,
      email:       trimmedEmail,
      displayName: trimmedName,
      role,
      mappedRole,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
