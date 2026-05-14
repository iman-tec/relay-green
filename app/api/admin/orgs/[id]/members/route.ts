/*
 * POST /api/admin/orgs/:id/members
 *   Invite a user under an existing org. The caller picks the role:
 *     - 'admin'   → another Enterprise Admin alongside the first one
 *     - 'builder' → a customer user under that org
 *
 *   Super Admin uses this both for real onboarding and for end-to-end
 *   testing without depending on the actual enterprise contact.
 *
 *   Body: { email, displayName, role?: 'admin' | 'builder' }
 *         role defaults to 'builder' for backwards compat.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ORG_MEMBER_ROLES = new Set(["admin", "builder"]);

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
  const role        = body.role && ORG_MEMBER_ROLES.has(body.role) ? body.role : "builder";

  if (!email || !displayName) {
    return NextResponse.json(
      { error: "Need email and displayName." },
      { status: 400 },
    );
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) {
    return NextResponse.json({ error: "Org not found." }, { status: 404 });
  }

  const trimmedEmail = email.toLowerCase();
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // Same "attach existing user" logic as POST /api/admin/orgs — if the
  // email is already in Supabase Auth, skip the invite and just bind
  // them to this org. Lets super_admin spin up org-internal test users
  // without needing a fresh inbox each time.
  const { data: existingPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = existingPage?.users?.find(
    (u) => u.email?.toLowerCase() === trimmedEmail,
  );

  let userId: string;
  let mode: "invited" | "attached_existing";

  if (existingUser) {
    userId = existingUser.id;
    mode   = "attached_existing";

    // Preserve any prior primary_role; only set org binding + onboarding.
    const { data: currentProfile } = await admin
      .from("profiles")
      .select("full_name, primary_role")
      .eq("id", userId)
      .maybeSingle();
    const cp = currentProfile as { full_name: string | null; primary_role: string | null } | null;

    await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       cp?.full_name?.trim() ? cp.full_name : displayName,
          primary_role:    cp?.primary_role ?? role,
          organization_id: orgId,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        display_name:    cp?.full_name?.trim() || displayName,
        role_label:      role,
        organization_id: orgId,
        org_name:        org.name,
      },
    }).catch(() => {});

    const { error: linkErr } = await admin.auth.admin.generateLink({
      type:  "magiclink",
      email: trimmedEmail,
      options: { redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin` },
    });
    if (linkErr) {
      console.warn(`[admin/orgs/${orgId}/members] magic-link send failed for ${trimmedEmail}: ${linkErr.message}`);
    }
  } else {
    const { data: createRes, error: createErr } =
      await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
        data: {
          display_name:    displayName,
          role_label:      role,
          organization_id: orgId,
          created_by:      actor.id,
        },
        redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin`,
      });
    if (createErr || !createRes.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "Couldn't invite user." },
        { status: 400 },
      );
    }
    userId = createRes.user.id;
    mode   = "invited";

    await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       displayName,
          primary_role:    role,
          organization_id: orgId,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );
  }

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role },
      { onConflict: "user_id,role", ignoreDuplicates: true },
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
