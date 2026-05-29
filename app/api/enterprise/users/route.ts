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
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { recordInvite } from "@/lib/relay/invites";
import { findUserInAnotherOrg, crossOrgError } from "@/lib/relay/orgGuard";
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

  // erased_at lives on the base `profiles` table, NOT the profiles_with_role
  // view (the view's column list was frozen before erased_at existed).
  // Fetch it directly and merge by id.
  const { data: erasedRows } = await admin
    .from("profiles")
    .select("id, erased_at")
    .in("id", profileIds);
  const erasedById = new Map<string, string | null>();
  for (const r of (erasedRows ?? []) as { id: string; erased_at: string | null }[]) {
    erasedById.set(r.id, r.erased_at);
  }
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
  const authByUser = new Map<string, { email: string; lastSignIn: string | null }>();
  for (const u of authPage?.users ?? []) {
    if (profileIds.includes(u.id)) {
      authByUser.set(u.id, {
        email:       u.email ?? "",
        lastSignIn:  u.last_sign_in_at ?? null,
      });
    }
  }

  const members = list
    .map((p) => {
      const rolesForUser = rolesByUser.get(p.id) ?? new Set<string>();
      const isStaff = Array.from(rolesForUser).some((r) => STAFF_ROLE_SET.has(r));
      const auth = authByUser.get(p.id);
      const erasedAt = erasedById.get(p.id) ?? null;
      const erased = Boolean(erasedAt);
      // Lifecycle status, NOT presence. The invite flow confirms the email
      // immediately (so the temp password works), so email_confirmed_at is
      // a useless "active" signal — it's true the instant we invite. Use
      // last_sign_in_at instead: null = invited-but-not-yet-accepted,
      // set = they've signed in. This is the SAME signal the invites table
      // uses (trg_mark_invites_accepted_on_signin flips sent→accepted on
      // first sign-in), so the Members status and the Invitations section
      // now agree instead of contradicting each other.
      const hasSignedIn = Boolean(auth?.lastSignIn);
      return {
        id:          p.id,
        // Erased members never expose name/email in API output — even though
        // the auth row still exists, GDPR portability says no PII surfaces.
        displayName: erased ? "" : (p.full_name ?? ""),
        email:       erased ? "" : (auth?.email ?? ""),
        roles:       Array.from(rolesForUser),
        primaryRole: p.primary_role ?? "",
        isStaff,
        status:      erased ? "erased" : hasSignedIn ? "active" : "invited",
        lastSignIn:  erased ? null : auth?.lastSignIn,
        createdAt:   p.created_at,
        erasedAt,
      };
    })
    .filter((m) => (scope === "staff" ? m.isStaff : !m.isStaff));

  return NextResponse.json({ members });
}

type ProvisionInput = { email?: string; displayName?: string; role?: string; departmentId?: string };
type ProvisionResult =
  | { ok: true; userId: string; role: string; departmentId: string | null; mode: "invited" | "attached_existing" }
  | { ok: false; status: number; error: string };

/** Invite + provision ONE member into orgId. Shared by the single + bulk POST paths. */
async function provisionMember(
  admin: SupabaseClient, orgId: string, actorId: string, input: ProvisionInput,
): Promise<ProvisionResult> {
  const { email, displayName, role, departmentId } = input;

  if (!email?.trim() || !displayName?.trim() || !role || !INVITABLE_ROLES.has(role)) {
    return { ok: false, status: 400, error: "Need email, displayName, and role ∈ {enterprise_admin, client}." };
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
      return { ok: false, status: 400, error: "Department doesn't belong to this organization." };
    }
    if (d.status !== "active") {
      return { ok: false, status: 400, error: "Department is suspended — reactivate it before adding members." };
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

  // GUARD: refuse if this email already belongs to a different enterprise —
  // never silently move them out of their current org.
  const orgGuard = await findUserInAnotherOrg(admin, trimmedEmail, orgId);
  if (orgGuard.blocked) {
    return { ok: false, status: 409, error: crossOrgError(orgGuard.orgName) };
  }

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
      return { ok: false, status: 409, error: "This user already belongs to another organization. Ask a super admin to release them first." };
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
      invited_by:      actorId,
      ...(resolvedDepartmentId ? {
        department_id:   resolvedDepartmentId,
        department_code: departmentCode,
        department_name: departmentName,
      } : {}),
    },
  });
  if (!invite.ok) {
    return { ok: false, status: 400, error: invite.error ?? "Invite failed." };
  }

  let userId = invite.userId ?? existing0?.id ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = lookup.data?.users?.find(
      (u) => u.email?.toLowerCase() === trimmedEmail,
    )?.id ?? null;
  }
  if (!userId) {
    return { ok: false, status: 500, error: "Member invited but auth row not yet visible — try again." };
  }

  // Resolve role_id for the assigned role.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle();
  const assignedRoleId = (roleRow as { id: string } | null)?.id;
  if (!assignedRoleId) {
    return { ok: false, status: 500, error: `Unknown role: ${role}` };
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
    return { ok: false, status: 500, error: profileErr.message };
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
    return { ok: false, status: 500, error: roleErr.message };
  }

  console.log(
    `[enterprise/users] org=${orgId} ${mode} ${trimmedEmail} as ${role}${resolvedDepartmentId ? ` (dept ${resolvedDepartmentId})` : ""}`,
  );

  return { ok: true, userId, role, departmentId: resolvedDepartmentId, mode };
}

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  const body = (await request.json().catch(() => ({}))) as
    & ProvisionInput
    & { recipients?: Array<{ email?: string; name?: string; displayName?: string; role?: string; departmentId?: string }> };

  // Record a company-scoped invite row so the shared status table tracks it.
  const track = async (email: string, name: string, role: string, departmentId: string | null) => {
    await recordInvite(admin, {
      email, name, role,
      scopeType: "company", scopeId: orgId,
      departmentId, invitedBy: actor.id,
    }).catch(() => {});
  };

  // Bulk path — shared InviteFlow posts { recipients: [...] }.
  if (Array.isArray(body.recipients)) {
    const recipients = body.recipients.filter((r) => r.email && r.email.includes("@"));
    if (recipients.length === 0) return NextResponse.json({ error: "No valid recipients." }, { status: 400 });
    if (recipients.length > 500) return NextResponse.json({ error: "Max 500 recipients per batch." }, { status: 400 });

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];
    for (const rec of recipients) {
      const email = rec.email!.trim().toLowerCase();
      const name = (rec.displayName ?? rec.name ?? email.split("@")[0]).trim();
      const role = rec.role || ROLE.client;
      const res = await provisionMember(admin, orgId, actor.id, {
        email, displayName: name, role, departmentId: rec.departmentId,
      });
      if (res.ok) { await track(email, name, role, res.departmentId); results.push({ email, ok: true }); }
      else results.push({ email, ok: false, error: res.error });
    }
    return NextResponse.json({ sent: results.filter((r) => r.ok).length, total: recipients.length, results });
  }

  // Legacy single path — { email, displayName, role, departmentId }.
  const res = await provisionMember(admin, orgId, actor.id, body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  await track(body.email!.trim().toLowerCase(), body.displayName!.trim(), res.role, res.departmentId);
  return NextResponse.json({
    user: {
      id:           res.userId,
      email:        body.email!.trim().toLowerCase(),
      displayName:  body.displayName!.trim(),
      role:         res.role,
      departmentId: res.departmentId,
    },
    invited:          res.mode === "invited",
    attachedExisting: res.mode === "attached_existing",
  });
}
