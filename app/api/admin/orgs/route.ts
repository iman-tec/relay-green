/*
 * Organizations API — list + create.
 *
 * GET  /api/admin/orgs
 *   Returns all organizations with their members (admin + customer users
 *   under each org). Caller must hold super_admin.
 *
 * POST /api/admin/orgs
 *   Creates an Org and its first Enterprise Admin in one shot.
 *   Body: { name, primaryDomain?, adminEmail, adminDisplayName }
 *   Returns the new org + plaintext one-time code for the admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, primary_domain, status, created_at")
    .order("created_at", { ascending: false });
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });

  if (!orgs || !orgs.length) {
    return NextResponse.json({ orgs: [] });
  }

  const orgIds = orgs.map((o) => o.id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, organization_id, primary_role")
    .in("organization_id", orgIds);

  const profileIds = (profiles ?? []).map((p) => p.id);
  const { data: roleRows } = profileIds.length
    ? await admin
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", profileIds)
    : { data: [] as { user_id: string; role: string }[] };
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  const { data: authPage } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const authByUser = new Map(
    (authPage?.users ?? []).map((u) => [
      u.id,
      {
        email:               u.email ?? "",
        banned:              Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
        awaitingFirstSignIn: !u.email_confirmed_at,
      },
    ]),
  );

  const membersByOrg = new Map<string, ReturnType<typeof formatMember>[]>();
  for (const p of profiles ?? []) {
    if (!p.organization_id) continue;
    const list = membersByOrg.get(p.organization_id) ?? [];
    list.push(formatMember(p, authByUser, rolesByUser));
    membersByOrg.set(p.organization_id, list);
  }

  return NextResponse.json({
    orgs: orgs.map((o) => ({
      id:            o.id,
      name:          o.name,
      primaryDomain: o.primary_domain,
      status:        o.status,
      createdAt:     o.created_at,
      members:       membersByOrg.get(o.id) ?? [],
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { name, primaryDomain, adminEmail, adminDisplayName } =
    (await request.json().catch(() => ({}))) as {
      name?: string;
      primaryDomain?: string;
      adminEmail?: string;
      adminDisplayName?: string;
    };

  if (
    !name?.trim() ||
    !adminEmail?.trim() ||
    !adminDisplayName?.trim()
  ) {
    return NextResponse.json(
      { error: "Need name, adminEmail, and adminDisplayName." },
      { status: 400 },
    );
  }

  const orgInsert: Record<string, unknown> = {
    name:               name.trim(),
    created_by_user_id: actor.id,
  };
  if (primaryDomain?.trim()) orgInsert.primary_domain = primaryDomain.trim();

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert(orgInsert)
    .select()
    .single();
  if (orgErr || !org) {
    return NextResponse.json({ error: orgErr?.message ?? "Couldn't create org." }, { status: 400 });
  }

  const trimmedEmail = adminEmail.trim().toLowerCase();
  const trimmedName  = adminDisplayName.trim();
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  const { data: createRes, error: createErr } =
    await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
      data: {
        display_name:    trimmedName,
        role_label:      "admin",
        organization_id: org.id,
        created_by:      actor.id,
      },
      redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin`,
    });
  if (createErr || !createRes.user) {
    // Roll back the org so we don't leave an admin-less stub.
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json(
      { error: createErr?.message ?? "Couldn't invite admin user." },
      { status: 400 },
    );
  }
  const userId = createRes.user.id;

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       trimmedName,
        primary_role:    "admin",
        organization_id: org.id,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

  console.log(
    `[admin/orgs] created org "${name}" — invite dispatched to admin ${trimmedEmail}`,
  );

  return NextResponse.json({
    org: {
      id:            org.id,
      name:          org.name,
      primaryDomain: org.primary_domain,
      status:        org.status,
      createdAt:     org.created_at,
    },
    admin: {
      id:          userId,
      email:       trimmedEmail,
      displayName: trimmedName,
    },
    invited: true,
  });
}

type Profile = {
  id: string;
  full_name: string | null;
  organization_id: string | null;
  primary_role: string | null;
};

type AuthInfo = {
  email: string;
  banned: boolean;
  awaitingFirstSignIn: boolean;
};

function formatMember(
  p: Profile,
  authByUser: Map<string, AuthInfo>,
  rolesByUser: Map<string, string[]>,
) {
  const a = authByUser.get(p.id);
  return {
    id:                  p.id,
    email:               a?.email ?? "",
    displayName:         p.full_name ?? "",
    roles:               rolesByUser.get(p.id) ?? [],
    primaryRole:         p.primary_role,
    status:              (a?.banned ? "DEACTIVATED" : "ACTIVE") as "DEACTIVATED" | "ACTIVE",
    awaitingFirstSignIn: a?.awaitingFirstSignIn ?? false,
  };
}
