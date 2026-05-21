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
 *   Body: { email, displayName, role: 'enterprise_admin' | 'client',
 *           departmentId? }
 *   Invites a new user, locking them to the caller's organization_id.
 *   When role='client' AND departmentId is set, the user is bound to
 *   that dept and marked as client_type='employee' so dept-pool minutes
 *   apply.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE, STAFF_ROLES as ALL_STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Roles enterprise admins can invite directly: a peer enterprise_admin
// (org-level admin) or a plain client (end-user, optionally bound to a
// department to become an employee).
const INVITABLE_ROLES: ReadonlySet<string> = new Set([
  ROLE.enterprise_admin,
  ROLE.client,
]);

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

  const { email, displayName, role, departmentId } =
    (await request.json().catch(() => ({}))) as {
      email?:        string;
      displayName?:  string;
      role?:         string;
      /** Optional. When set on a client invite, the new user is bound to
       *  this department and marked as client_type='employee'. Ignored for
       *  enterprise_admin invites (admins aren't bound to a single dept). */
      departmentId?: string;
    };

  if (!email?.trim() || !displayName?.trim() || !role || !INVITABLE_ROLES.has(role)) {
    return NextResponse.json(
      { error: "Need email, displayName, and role ∈ {enterprise_admin, client}." },
      { status: 400 },
    );
  }

  // Validate department membership before any email goes out — must
  // belong to the caller's org. Ignored for enterprise_admin invites
  // (admins aren't bound to a single dept).
  let resolvedDepartmentId: string | null = null;
  let departmentCode: string | null = null;
  let departmentName: string | null = null;
  if (role === ROLE.client && typeof departmentId === "string" && departmentId.trim()) {
    const { data: dept } = await admin
      .from("departments")
      .select("id, enterprise_id, status, name, department_code")
      .eq("id", departmentId.trim())
      .maybeSingle();
    const d = dept as { id: string; enterprise_id: string; status: string; name: string; department_code: string } | null;
    if (!d || d.enterprise_id !== orgId) {
      return NextResponse.json(
        { error: "Department doesn't belong to this organization." },
        { status: 400 },
      );
    }
    if (d.status !== "active") {
      return NextResponse.json(
        { error: "Department is suspended — reactivate it before adding members." },
        { status: 400 },
      );
    }
    resolvedDepartmentId = d.id;
    departmentCode = d.department_code;
    departmentName = d.name;
  }

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
  // role_label drives the per-role copy in the invite template; when we're
  // binding the user to a department, flip it from "member" to "employee"
  // so the template renders the dept-bound greeting + shows the dept code.
  // role_label drives the per-role copy in the invite template. For a
  // client bound to a department, flip to "employee" so the template
  // renders the dept-bound greeting + shows the dept code.
  const isEmployeeInvite = role === ROLE.client && resolvedDepartmentId !== null;
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: trimmedName,
    metadata: {
      role_label:      isEmployeeInvite ? "employee" : role,
      organization_id: orgId,
      org_name:        org?.name ?? "",
      enterprise_code: org?.enterprise_code ?? "",
      invited_by:      actor.id,
      ...(resolvedDepartmentId ? {
        department_id:   resolvedDepartmentId,
        department_code: departmentCode,
        department_name: departmentName,
      } : {}),
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

  // Resolve role_id for the assigned role.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle();
  const assignedRoleId = (roleRow as { id: string } | null)?.id;
  if (!assignedRoleId) {
    return NextResponse.json({ error: `Unknown role: ${role}` }, { status: 500 });
  }

  // Profile upsert: bind to this org, preserve existing primary_role +
  // name if already set.
  const { data: prior2 } = await admin
    .from("profiles_with_role")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const p = prior2 as { full_name: string | null; primary_role_id: string | null } | null;

  // Build the upsert payload. When the inviter selected a department,
  // bind the user to it AND flip client_type to 'employee' so dept-pool
  // billing kicks in on their first session. Otherwise keep the row at
  // client_type='client' (the default).
  const profileUpdate: Record<string, unknown> = {
    id:              userId,
    full_name:       p?.full_name?.trim() ? p.full_name : trimmedName,
    primary_role_id: p?.primary_role_id ?? assignedRoleId,
    organization_id: orgId,
    is_onboarded:    true,
  };
  if (resolvedDepartmentId) {
    profileUpdate.department_id = resolvedDepartmentId;
    profileUpdate.client_type   = "employee";
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(profileUpdate, { onConflict: "id" });
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: assignedRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
  if (roleErr) {
    if (mode === "invited") {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  console.log(
    `[enterprise/users] org=${orgId} ${mode} ${trimmedEmail} as ${role}${resolvedDepartmentId ? ` (dept ${resolvedDepartmentId})` : ""}`,
  );

  return NextResponse.json({
    user: {
      id:           userId,
      email:        trimmedEmail,
      displayName:  trimmedName,
      role,
      departmentId: resolvedDepartmentId,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
