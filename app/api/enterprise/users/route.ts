/*
 * Enterprise admin's user-management API — list + invite, scoped to
 * the caller's organization_id.
 *
 * GET  /api/enterprise/users?scope=staff|users
 *   Lists profiles in the caller's org, split by role. Staff = anyone
 *   holding engineer/pod_lead/ops_manager/admin/enterprise_admin.
 *   Users = everyone else under the same org.
 *
 * POST /api/enterprise/users
 *   Body: { email, displayName, role: 'manager' | 'analyst' | 'member' }
 *   Invites a new user, locking them to the caller's organization_id.
 *   role maps to:
 *     manager → admin       (org-internal admin within their org)
 *     analyst → ops_manager (read-only org analytics within their org)
 *     member  → builder     (regular end-user)
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ENT_ROLE_TO_USER_ROLE: Record<string, string> = {
  manager: "admin",
  analyst: "ops_manager",
  member:  "builder",
};

const STAFF_ROLES = new Set([
  "engineer", "pod_lead", "ops_manager", "admin", "enterprise_admin", "super_admin",
]);

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
    .from("profiles")
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
    .from("user_roles")
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
      const isStaff = Array.from(rolesForUser).some((r) => STAFF_ROLES.has(r));
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
      { error: "Need email, displayName, and role ∈ {manager, analyst, member}." },
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
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // Existing-user attach path — same shape as the super_admin org-create
  // flow. Lets an Enterprise Admin pull in an email that's already in
  // Supabase Auth without a "user already registered" error.
  const { data: existingPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = existingPage?.users?.find(
    (u) => u.email?.toLowerCase() === trimmedEmail,
  );

  let userId: string;
  let mode: "invited" | "attached_existing";

  if (existingUser) {
    userId = existingUser.id;
    mode   = "attached_existing";

    // Refuse cross-org pull-ins: an existing user already bound to a
    // different organization_id must be released first (super_admin
    // intervention). Prevents accidental hijack of someone else's user.
    const { data: prior } = await admin
      .from("profiles")
      .select("organization_id, full_name, primary_role")
      .eq("id", userId)
      .maybeSingle();
    const p = prior as { organization_id: string | null; full_name: string | null; primary_role: string | null } | null;
    if (p?.organization_id && p.organization_id !== orgId) {
      return NextResponse.json(
        { error: "This user already belongs to another organization. Ask a super admin to release them first." },
        { status: 409 },
      );
    }

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       p?.full_name?.trim() ? p.full_name : trimmedName,
          primary_role:    p?.primary_role ?? mappedRole,
          organization_id: orgId,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );
    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        display_name:    p?.full_name?.trim() || trimmedName,
        role_label:      role,
        organization_id: orgId,
        org_name:        org?.name ?? "",
        enterprise_code: org?.enterprise_code ?? "",
      },
    }).catch(() => {});

    const { error: linkErr } = await admin.auth.admin.generateLink({
      type:  "magiclink",
      email: trimmedEmail,
      options: { redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin` },
    });
    if (linkErr) {
      console.warn(`[enterprise/users] magic-link send failed for ${trimmedEmail}: ${linkErr.message}`);
    }
  } else {
    const { data: createRes, error: createErr } =
      await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
        data: {
          display_name:    trimmedName,
          role_label:      role,                  // ent-facing: manager/analyst/member
          mapped_role:     mappedRole,            // backend role
          organization_id: orgId,
          org_name:        org?.name ?? "",
          enterprise_code: org?.enterprise_code ?? "",
          invited_by:      actor.id,
        },
        redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin`,
      });
    if (createErr || !createRes.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "inviteUserByEmail failed." },
        { status: 400 },
      );
    }
    userId = createRes.user.id;
    mode   = "invited";

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       trimmedName,
          primary_role:    mappedRole,
          organization_id: orgId,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );
    if (profileErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }
  }

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: mappedRole },
      { onConflict: "user_id,role", ignoreDuplicates: true },
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
