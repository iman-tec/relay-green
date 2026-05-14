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
    .select("id, name, primary_domain, status, enterprise_code, created_at")
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

  // Generate a unique enterprise_code. Retry on unique-violation; max 5
  // attempts is more than enough for a 32-bit-ish keyspace.
  type OrgRow = {
    id: string; name: string; primary_domain: string | null;
    status: string; enterprise_code: string; created_at: string;
  };
  let org: OrgRow | undefined;
  let lastErr: { message?: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const orgInsert: Record<string, unknown> = {
      name:               name.trim(),
      created_by_user_id: actor.id,
      enterprise_code:    generateEnterpriseCode(name.trim()),
    };
    if (primaryDomain?.trim()) orgInsert.primary_domain = primaryDomain.trim();

    const { data, error } = await admin
      .from("organizations")
      .insert(orgInsert)
      .select("id, name, primary_domain, status, enterprise_code, created_at")
      .single();
    if (!error && data) {
      org = data as unknown as OrgRow;
      break;
    }
    lastErr = error;
    // 23505 = unique_violation — retry with a fresh code.
    if (error?.code !== "23505") break;
  }
  if (!org) {
    return NextResponse.json({ error: lastErr?.message ?? "Couldn't create org." }, { status: 400 });
  }

  const trimmedEmail = adminEmail.trim().toLowerCase();
  const trimmedName  = adminDisplayName.trim();
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // If the email is already in Supabase Auth, skip the invite and attach
  // the existing user to the new org as enterprise_admin. This is the
  // "I can be a user of my own org too" case — super admin spinning up an
  // org for themselves, or attaching a previously-staff member.
  const { data: existingPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = existingPage?.users?.find(
    (u) => u.email?.toLowerCase() === trimmedEmail,
  );

  let userId: string;
  let mode: "invited" | "attached_existing";

  if (existingUser) {
    userId = existingUser.id;
    mode   = "attached_existing";

    // Don't clobber primary_role for existing users (a super_admin who
    // creates an org for themselves should stay super_admin). Set the
    // organization_id so the enterprise console scopes correctly; refresh
    // full_name only if blank.
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
          full_name:       cp?.full_name?.trim() ? cp.full_name : trimmedName,
          primary_role:    cp?.primary_role ?? "enterprise_admin",
          organization_id: org.id,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );

    // Update user_metadata so the Magic Link email template can render
    // the org context ("You've been added to <Org>").
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        display_name:    cp?.full_name?.trim() || trimmedName,
        role_label:      "enterprise_admin",
        organization_id: org.id,
        org_name:        org.name,
        enterprise_code: org.enterprise_code,
      },
    }).catch((e) => {
      console.warn(`[admin/orgs] couldn't refresh user_metadata: ${e instanceof Error ? e.message : e}`);
    });

    // Trigger the Magic Link email (which Supabase Auth sends via your
    // configured SMTP) so the existing user gets a sign-in link with
    // their fresh org binding ready to go.
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type:  "magiclink",
      email: trimmedEmail,
      options: { redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin` },
    });
    if (linkErr) {
      console.warn(`[admin/orgs] magic-link send failed for ${trimmedEmail}: ${linkErr.message}`);
    } else {
      console.log(`[admin/orgs] magic-link sent to ${trimmedEmail} (existing user attached)`);
    }
  } else {
    const { data: createRes, error: createErr } =
      await admin.auth.admin.inviteUserByEmail(trimmedEmail, {
        data: {
          display_name:    trimmedName,
          role_label:      "enterprise_admin",
          organization_id: org.id,
          org_name:        org.name,
          enterprise_code: org.enterprise_code,
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
    userId = createRes.user.id;
    mode   = "invited";

    await admin
      .from("profiles")
      .upsert(
        {
          id:              userId,
          full_name:       trimmedName,
          primary_role:    "enterprise_admin",
          organization_id: org.id,
          is_onboarded:    true,
        },
        { onConflict: "id" },
      );
  }

  // Grant the role in both code paths. Idempotent — keeps any prior roles
  // (e.g. super_admin) intact and just adds enterprise_admin on top.
  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "enterprise_admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

  console.log(
    `[admin/orgs] created org "${name}" (code=${org.enterprise_code}) — ${mode} ${trimmedEmail}`,
  );

  return NextResponse.json({
    org: {
      id:             org.id,
      name:           org.name,
      primaryDomain:  org.primary_domain,
      status:         org.status,
      enterpriseCode: org.enterprise_code,
      createdAt:      org.created_at,
    },
    admin: {
      id:          userId,
      email:       trimmedEmail,
      displayName: trimmedName,
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}

/** Crockford-ish base32 (no 0/O/1/I/L) — phone-friendly when read aloud. */
const CROCKFORD = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function randSegment(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return out;
}

function generateEnterpriseCode(orgName: string): string {
  const slug = orgName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ORG";
  return `${slug}-${randSegment(4)}-${randSegment(4)}`;
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
