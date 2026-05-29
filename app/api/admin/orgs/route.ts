/*
 * Organizations API — list + create.
 *
 * GET  /api/admin/orgs
 *   Returns all organizations with their enterprise_admin members and their
 *   departments. Caller must hold super_admin. The departments list reflects
 *   what the org's enterprise_admin manages at /enterprise/departments —
 *   surfaced here so the super_admin can see the org's structure at a glance
 *   without leaving the /admin/users console.
 *
 * POST /api/admin/orgs
 *   Creates an Org and its first Enterprise Admin in one shot.
 *   Body: { name, primaryDomain?, adminEmail, adminDisplayName, allocatedMinutes? }
 *   Returns the new org + plaintext one-time code for the admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { notifyResellerClientOnboarded } from "@/lib/relay/resellerNotify";
import { findUserInAnotherOrg, crossOrgError } from "@/lib/relay/orgGuard";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, primary_domain, status, enterprise_code, enterprise_type, reseller_id, allocated_minutes, used_minutes, remaining_minutes, created_at")
    .order("created_at", { ascending: false });
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });

  if (!orgs || !orgs.length) {
    return NextResponse.json({ orgs: [] });
  }

  // Resolve the reseller names for inorganic orgs so the UI can show
  // "via Reseller Name" instead of just the raw id. Skip when no inorganic
  // orgs exist.
  type OrgRow = {
    id: string; name: string; primary_domain: string | null; status: string;
    enterprise_code: string; enterprise_type: string;
    reseller_id: string | null;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number;
    created_at: string;
  };
  const orgRows = orgs as OrgRow[];
  const resellerIds = Array.from(new Set(
    orgRows.map((o) => o.reseller_id).filter((id): id is string => !!id),
  ));
  const resellerNameById = new Map<string, string>();
  if (resellerIds.length > 0) {
    const { data: resellers } = await admin
      .from("resellers")
      .select("id, name")
      .in("id", resellerIds);
    for (const r of (resellers ?? []) as { id: string; name: string }[]) {
      resellerNameById.set(r.id, r.name);
    }
  }

  const orgIds = orgs.map((o) => o.id);
  const { data: profiles } = await admin
    .from("profiles_with_role")
    .select("id, full_name, organization_id, primary_role")
    .in("organization_id", orgIds);

  const profileIds = (profiles ?? []).map((p) => p.id);
  const { data: roleRows } = profileIds.length
    ? await admin
        .from("user_role_names")
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

  // Departments per org. We fetch all of them in one query, then count
  // clients (client_type='employee') per department in a second pass.
  const { data: deptRows } = await admin
    .from("departments")
    .select(
      "id, enterprise_id, name, department_code, admin_user_id, status, allocated_minutes, used_minutes, remaining_minutes, created_at",
    )
    .in("enterprise_id", orgIds)
    .order("created_at", { ascending: false });

  type DeptRow = {
    id: string;
    enterprise_id: string;
    name: string;
    department_code: string;
    admin_user_id: string | null;
    status: string;
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
    created_at: string;
  };
  const depts = (deptRows ?? []) as DeptRow[];

  // Member count per department (only employees, not admins).
  const deptIds = depts.map((d) => d.id);
  const memberCountByDept = new Map<string, number>();
  if (deptIds.length > 0) {
    const { data: empRows } = await admin
      .from("profiles")
      .select("department_id")
      .in("department_id", deptIds)
      .eq("client_type", "employee");
    for (const e of (empRows ?? []) as { department_id: string }[]) {
      memberCountByDept.set(e.department_id, (memberCountByDept.get(e.department_id) ?? 0) + 1);
    }
  }

  const departmentsByOrg = new Map<string, ReturnType<typeof formatDepartment>[]>();
  for (const d of depts) {
    const list = departmentsByOrg.get(d.enterprise_id) ?? [];
    list.push(formatDepartment(d, memberCountByDept.get(d.id) ?? 0));
    departmentsByOrg.set(d.enterprise_id, list);
  }

  return NextResponse.json({
    orgs: orgRows.map((o) => ({
      id:                o.id,
      name:              o.name,
      primaryDomain:     o.primary_domain,
      status:            o.status,
      enterpriseType:    o.enterprise_type,                   // 'organic' | 'inorganic'
      resellerId:        o.reseller_id,                       // non-null when inorganic
      resellerName:      o.reseller_id ? (resellerNameById.get(o.reseller_id) ?? null) : null,
      allocatedMinutes:  Number(o.allocated_minutes ?? 0),
      usedMinutes:       Number(o.used_minutes ?? 0),
      remainingMinutes:  Number(o.remaining_minutes ?? 0),
      createdAt:         o.created_at,
      members:           membersByOrg.get(o.id) ?? [],
      departments:       departmentsByOrg.get(o.id) ?? [],
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { name, primaryDomain, adminEmail, adminDisplayName, allocatedMinutes, resellerId } =
    (await request.json().catch(() => ({}))) as {
      name?: string;
      primaryDomain?: string;
      adminEmail?: string;
      adminDisplayName?: string;
      allocatedMinutes?: number | string;
      /** When set, creates an inorganic enterprise under that reseller
       *  (org.reseller_id = resellerId). transfer_to_organization then
       *  debits the reseller pool instead of minting unbacked minutes. */
      resellerId?: string;
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

  // GUARD: the new org's admin email must not already belong to another
  // enterprise — otherwise creating the org would hijack that user. "" as
  // the target means "any existing org binding blocks" (this org has no id yet).
  {
    const guard = await findUserInAnotherOrg(admin, adminEmail.trim().toLowerCase(), "");
    if (guard.blocked) {
      return NextResponse.json({ error: crossOrgError(guard.orgName) }, { status: 409 });
    }
  }

  // Optional initial minutes allocation. Per spec, the organic enterprise
  // creation form includes a "Minutes Allocation" field; default to 0
  // when the caller omits it (e.g. legacy clients that don't yet send it).
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  // Validate the resellerId (if supplied) — must exist, be active, AND
  // have enough minutes to cover the allocation. We do this pre-flight
  // so the error message is clear; transfer_to_organization revalidates
  // inside the RPC, but its error text is less useful.
  if (resellerId && typeof resellerId === "string") {
    const { data: r } = await admin
      .from("resellers")
      .select("id, status, remaining_minutes")
      .eq("id", resellerId)
      .maybeSingle();
    const rr = r as { id: string; status: string; remaining_minutes: number } | null;
    if (!rr) {
      return NextResponse.json({ error: "Reseller not found." }, { status: 404 });
    }
    if (rr.status !== "active") {
      return NextResponse.json({ error: "Reseller is suspended." }, { status: 400 });
    }
    if (allocNum > 0 && allocNum > Number(rr.remaining_minutes ?? 0)) {
      return NextResponse.json(
        { error: `Allocation exceeds the reseller's remaining minutes (${rr.remaining_minutes}).` },
        { status: 400 },
      );
    }
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
    if (resellerId) {
      // The DB has a CHECK constraint pairing enterprise_type with reseller_id:
      //   inorganic ↔ reseller_id NOT NULL
      //   organic   ↔ reseller_id NULL
      // Setting reseller_id without flipping enterprise_type would violate it.
      orgInsert.reseller_id     = resellerId;
      orgInsert.enterprise_type = "inorganic";
    }

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

  // If the email is already in Supabase Auth, skip the invite and attach
  // the existing user to the new org as enterprise_admin. This is the
  // "I can be a user of my own org too" case — super admin spinning up an
  // org for themselves, or attaching a previously-staff member.
  // Unified invite (inviteUserByEmail → signInWithOtp fallback). Picks
  // up the org context via user_metadata so the email template can show
  // "You've been added to <Org>".
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: trimmedName,
    metadata: {
      role_label:        "enterprise_admin",
      organization_id:   org.id,
      org_name:          org.name,
      enterprise_code:   org.enterprise_code,
      allocated_minutes: allocNum,
      created_by:        actor.id,
    },
  });
  if (!invite.ok) {
    // Roll back the org so we don't leave an admin-less stub.
    await admin.from("organizations").delete().eq("id", org.id);
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
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json(
      { error: "Admin invited but auth row not yet visible — try again in a moment." },
      { status: 500 },
    );
  }

  // Resolve enterprise_admin role_id once for both writes below.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.enterprise_admin)
    .maybeSingle();
  const enterpriseAdminRoleId = (roleRow as { id: string } | null)?.id;
  if (!enterpriseAdminRoleId) {
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: "enterprise_admin role not seeded" }, { status: 500 });
  }

  // Don't clobber primary_role for existing users (a super_admin who
  // creates an org should stay super_admin). Set organization_id so
  // the enterprise console scopes correctly; refresh full_name only
  // if previously blank.
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
        full_name:       cp?.full_name?.trim() ? cp.full_name : trimmedName,
        primary_role_id: cp?.primary_role_id ?? enterpriseAdminRoleId,
        organization_id: org.id,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  // Grant the role in both code paths. Idempotent — keeps any prior roles
  // (e.g. super_admin) intact and just adds enterprise_admin on top.
  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: enterpriseAdminRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );

  // Initial minutes allocation. Organic enterprises (reseller_id=NULL)
  // route through the same RPC; the function detects organic and skips
  // any parent-debit step. Soft-warn on failure so we don't roll back
  // a successfully invited admin over a fixable minutes problem.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_organization", {
      _org_id: org.id,
      _amount: allocNum,
    });
    if (tErr) {
      console.warn("[admin/orgs] initial transfer_to_organization failed:", tErr.message);
    }
  }

  // If this is a reseller-linked enterprise, fan out an in-app notification
  // to the reseller's team. The actor is a super_admin (not on the team),
  // so we don't exclude anyone. Best-effort — never fails the request.
  if (resellerId && typeof resellerId === "string") {
    void notifyResellerClientOnboarded(admin, {
      resellerId,
      enterpriseId:   org.id,
      enterpriseName: org.name,
      actorUserId:    null,
    });
  }

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

type DeptDbRow = {
  id: string;
  name: string;
  department_code: string;
  admin_user_id: string | null;
  status: string;
  allocated_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  created_at: string;
};

function formatDepartment(d: DeptDbRow, memberCount: number) {
  return {
    id:                d.id,
    name:              d.name,
    departmentCode:    d.department_code,
    adminUserId:       d.admin_user_id,
    status:            d.status,
    allocatedMinutes:  Number(d.allocated_minutes ?? 0),
    usedMinutes:       Number(d.used_minutes ?? 0),
    remainingMinutes:  Number(d.remaining_minutes ?? 0),
    memberCount,
    createdAt:         d.created_at,
  };
}
