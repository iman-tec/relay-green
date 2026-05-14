/*
 * Admin users API — list + create.
 *
 * GET  /api/admin/users?scope=staff
 *   Lists internal staff users (engineers, supervisors, internal admins,
 *   super admins). Scope=customer is not yet implemented.
 *
 * POST /api/admin/users
 *   Creates a Supabase auth user, assigns a role in user_roles, generates
 *   an 8-digit sign-in code (the user's Supabase password), and returns
 *   the plaintext code ONCE so the admin UI can show it to the operator.
 *
 *   Body: { email, displayName, role }
 *     role ∈ { engineer, pod_lead, ops_manager, admin }
 *     (super_admin can only be granted via the bootstrap script.)
 *
 * Caller must hold super_admin role.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const STAFF_ROLES = new Set([
  "engineer",
  "pod_lead",
  "ops_manager",
  "admin",
  "super_admin",
]);
const CREATABLE_ROLES = new Set([
  "engineer",
  "pod_lead",
  "ops_manager",
  "admin",
]);

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const scope = new URL(request.url).searchParams.get("scope") ?? "staff";

  // Pull profiles + roles + auth metadata. Three queries instead of a join
  // because user_roles RLS makes a single PostgREST embed thorny under
  // service-role; the join here is in JS over a few hundred rows.
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, primary_role, created_at")
    .order("created_at", { ascending: false });
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  const ids = (profiles ?? []).map((p) => p.id);
  const { data: roleRows } = ids.length
    ? await admin
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", ids)
    : { data: [] as { user_id: string; role: string }[] };

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  // Email + ban state come from auth.users. listUsers caps at 1000/page;
  // we fetch a single page since admin consoles rarely scroll past that
  // before paginating proper.
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

  const rows = (profiles ?? [])
    .map((p) => {
      const auth = authByUser.get(p.id);
      const roles = rolesByUser.get(p.id) ?? [];
      return {
        id:                  p.id,
        email:               auth?.email ?? "",
        displayName:         p.full_name ?? "",
        roles,
        primaryRole:         p.primary_role ?? null,
        status:              auth?.banned ? "DEACTIVATED" : "ACTIVE",
        awaitingFirstSignIn: auth?.awaitingFirstSignIn ?? false,
        createdAt:           p.created_at,
      };
    })
    .filter((row) => {
      if (scope === "staff") {
        return row.roles.some((r) => STAFF_ROLES.has(r));
      }
      // scope=customer fall-through (not implemented yet)
      return !row.roles.some((r) => STAFF_ROLES.has(r));
    });

  return NextResponse.json({ users: rows });
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, user: actor } = gate;

  const { email, displayName, role } = await request.json().catch(() => ({}));

  if (
    typeof email !== "string" || !email.trim() ||
    typeof displayName !== "string" || !displayName.trim() ||
    typeof role !== "string" || !CREATABLE_ROLES.has(role)
  ) {
    return NextResponse.json(
      {
        error:
          "Need email, displayName, and role ∈ {engineer, pod_lead, ops_manager, admin}.",
      },
      { status: 400 },
    );
  }

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName  = displayName.trim();
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // If the email already has an auth user, skip the invite and grant the
  // requested role to that user. Lets super_admin make themselves an
  // engineer for testing, etc. without needing a brand-new inbox.
  const { data: existingPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = existingPage?.users?.find(
    (u) => u.email?.toLowerCase() === trimmedEmail,
  );

  let userId: string;
  let mode: "invited" | "attached_existing";

  if (existingUser) {
    userId = existingUser.id;
    mode   = "attached_existing";

    // Keep prior primary_role if set; refresh display name only if blank.
    const { data: currentProfile } = await admin
      .from("profiles")
      .select("full_name, primary_role")
      .eq("id", userId)
      .maybeSingle();
    const cp = currentProfile as { full_name: string | null; primary_role: string | null } | null;

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id:           userId,
          full_name:    cp?.full_name?.trim() ? cp.full_name : trimmedName,
          primary_role: cp?.primary_role ?? role,
          is_onboarded: true,
        },
        { onConflict: "id" },
      );
    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        display_name: cp?.full_name?.trim() || trimmedName,
        role_label:   role,
      },
    }).catch(() => {});

    const { error: linkErr } = await admin.auth.admin.generateLink({
      type:  "magiclink",
      email: trimmedEmail,
      options: { redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin` },
    });
    if (linkErr) {
      console.warn(`[admin/users] magic-link send failed for ${trimmedEmail}: ${linkErr.message}`);
    }
  } else {
    const { data: createRes, error: createErr } =
      await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
        data: {
          display_name: trimmedName,
          role_label:   role,
          created_by:   actor.id,
        },
        redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin`,
      });
    if (createErr || !createRes.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "inviteUserByEmail failed" },
        { status: 400 },
      );
    }
    userId = createRes.user.id;
    mode   = "invited";

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id:           userId,
          full_name:    trimmedName,
          primary_role: role,
          is_onboarded: true,
        },
        { onConflict: "id" },
      );
    if (profileErr) {
      // Roll back the auth user — we don't want orphans. Only safe for
      // freshly-invited users; never delete existing ones.
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }
  }

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (roleErr) {
    // Only delete the auth user if we just created them in this request.
    if (mode === "invited") {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  console.log(
    `[admin/users] ${mode} ${trimmedEmail} (${role})`,
  );

  return NextResponse.json({
    user: {
      id:           userId,
      email:        trimmedEmail,
      displayName:  trimmedName,
      role,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
