/*
 * Admin users API — list + create.
 *
 * GET  /api/admin/users?scope=staff
 *   Lists internal staff users (engineers, supervisors, super admins, plus
 *   enterprise + department admins + resellers). Scope=customer flips the
 *   filter to "everyone but staff" (i.e. clients).
 *
 * POST /api/admin/users
 *   Creates a Supabase auth user, assigns a role, and triggers an invite
 *   email. Body: { email, displayName, role }.
 *   role ∈ { engineer, supervisor, super_admin } — platform-side roles
 *   only. Enterprise-side roles (enterprise_admin, department_admin) are
 *   created via /api/admin/orgs and the enterprise console respectively.
 *
 * Caller must hold super_admin role.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import {
  applySearch,
  listResponse,
  parseListQuery,
} from "@/lib/api/list-query";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE, STAFF_ROLES as ALL_STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAFF_ROLE_SET: ReadonlySet<string> = new Set(ALL_STAFF_ROLES);
const CREATABLE_ROLES: ReadonlySet<string> = new Set([
  ROLE.engineer,
  ROLE.supervisor,
  ROLE.super_admin,
]);

// Sortable columns map to actual `profiles` columns (the table we paginate
// against). Search runs an ilike on `full_name` (trigram-indexed) and we
// merge in the email match after fetching auth rows for the page.
const SORTABLE = ["displayName", "createdAt", "primaryRole"] as const;
type SortKey = (typeof SORTABLE)[number];
const SORT_COLUMN_MAP: Record<SortKey, string> = {
  displayName: "full_name",
  createdAt: "created_at",
  primaryRole: "primary_role",
};

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "staff";
  const list = parseListQuery(url, {
    sortable: SORTABLE,
    defaultSort: { column: "createdAt", dir: "desc" },
    filters: ["role"] as const,
    defaultPageSize: 25,
  });

  // 1. Scope the universe via user_role_names. Staff = anyone with a staff
  //    role (or filtered to a specific staff role); non-staff = everyone else.
  let staffUserIds: string[] | null = null;
  if (scope === "staff" || list.filters.role) {
    let rq = admin.from("user_role_names").select("user_id");
    if (list.filters.role) {
      rq = rq.eq("role", list.filters.role);
    } else {
      rq = rq.in("role", Array.from(STAFF_ROLE_SET));
    }
    const { data: roleScope, error: roleErr } = await rq;
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }
    staffUserIds = Array.from(
      new Set((roleScope ?? []).map((r: { user_id: string }) => r.user_id))
    );
  }

  // 2. Paginated profiles query — pulls just the page slice (≤ pageSize).
  let pq = admin
    .from("profiles_with_role")
    .select("id, full_name, primary_role, created_at", { count: "exact" });

  if (scope === "staff" || list.filters.role) {
    if ((staffUserIds ?? []).length === 0) {
      return NextResponse.json(listResponse([], 0, list.page, list.pageSize));
    }
    pq = pq.in("id", staffUserIds!);
  } else {
    // scope=customer → exclude everyone who holds any staff role. Always
    // run this exclusion (the earlier branch only populated staffUserIds
    // for the staff scope or when a role filter is set).
    const { data: staffOnly } = await admin
      .from("user_role_names")
      .select("user_id")
      .in("role", Array.from(STAFF_ROLE_SET));
    const excludeIds = Array.from(
      new Set((staffOnly ?? []).map((r: { user_id: string }) => r.user_id))
    );
    if (excludeIds.length > 0) {
      pq = pq.not("id", "in", `(${excludeIds.join(",")})`);
    }
  }

  pq = applySearch(pq, list.q, ["full_name"]);

  if (list.sort) {
    const col = SORT_COLUMN_MAP[list.sort.column as SortKey];
    pq = pq.order(col, {
      ascending: list.sort.dir === "asc",
      nullsFirst: false,
    });
  }
  pq = pq.range(list.range[0], list.range[1]);

  const { data: profiles, count, error: profErr } = await pq;
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  const pageIds = (profiles ?? []).map((p: { id: string }) => p.id);

  if (pageIds.length === 0) {
    return NextResponse.json(
      listResponse([], count ?? 0, list.page, list.pageSize)
    );
  }

  // 3. Roles + auth-side meta (email, banned_until, email_confirmed_at)
  //    for JUST the page slice. user_meta_for_admin RPC joins auth.users
  //    by id — far cheaper than listUsers({ perPage: 1000 }).
  const [{ data: roleRows }, { data: metaRows }] = await Promise.all([
    admin
      .from("user_role_names")
      .select("user_id, role")
      .in("user_id", pageIds),
    admin.rpc("user_meta_for_admin", { _ids: pageIds }),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  }
  type Meta = {
    id: string;
    email: string | null;
    banned_until: string | null;
    email_confirmed_at: string | null;
  };
  const metaById = new Map<string, Meta>();
  for (const m of (metaRows ?? []) as Meta[]) {
    metaById.set(m.id, m);
  }

  const now = Date.now();
  const rows = (profiles ?? []).map(
    (p: {
      id: string;
      full_name: string | null;
      primary_role: string | null;
      created_at: string;
    }) => {
      const m = metaById.get(p.id);
      const banned = !!(
        m?.banned_until && new Date(m.banned_until).getTime() > now
      );
      return {
        id: p.id,
        email: m?.email ?? "",
        displayName: p.full_name ?? "",
        roles: rolesByUser.get(p.id) ?? [],
        primaryRole: p.primary_role ?? null,
        status: banned ? "DEACTIVATED" : "ACTIVE",
        awaitingFirstSignIn: !m?.email_confirmed_at,
        createdAt: p.created_at,
      };
    }
  );

  return NextResponse.json(
    listResponse(rows, count ?? 0, list.page, list.pageSize)
  );
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, user: actor } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    displayName?: string;
    role?: string;
    podName?: string;
    podRole?: "supervisor" | "engineer" | null;
  };
  const { email, displayName, role, podName, podRole } = body;

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    typeof role !== "string" ||
    !CREATABLE_ROLES.has(role)
  ) {
    return NextResponse.json(
      {
        error:
          "Need email, displayName, and role ∈ {engineer, supervisor, super_admin}.",
      },
      { status: 400 }
    );
  }

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = displayName.trim();

  // Invite-only mode (bugs2.txt #1) — admin-driven pod additions must
  // send a proper "Invite User" email (so the recipient sees role + pod
  // context + a setup CTA), never the magic-link/OTP fallback. For
  // already-confirmed users we silently attach them; they already have
  // an account and don't need an authentication email.
  //
  // Pod context is forwarded into user_metadata so the Supabase invite
  // template can reference {{ .Data.invited_role }} / {{ .Data.pod_name }}.
  const invite = await sendInvitationEmail(admin, {
    email: trimmedEmail,
    displayName: trimmedName,
    inviteOnly: true,
    metadata: {
      role_label: role,
      created_by: actor.id,
      ...(podName ? { pod_name: podName } : {}),
      ...(podRole ? { pod_role: podRole } : {}),
    },
  });
  if (!invite.ok) {
    return NextResponse.json({ error: invite.error }, { status: 400 });
  }

  // Resolve the auth user. inviteUserByEmail returns user.id directly;
  // signInWithOtp doesn't, so we look it up by email via auth.admin.
  let userId = invite.userId ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId =
      lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)
        ?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json(
      {
        error:
          "User invited but auth row not yet visible — try again in a moment.",
      },
      { status: 500 }
    );
  }

  // Resolve role_id once — both profile (primary_role_id) and user_roles
  // (role_id) need it.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    return NextResponse.json(
      { error: `Unknown role: ${role}` },
      { status: 500 }
    );
  }

  // Upsert profile. For brand-new accounts this writes name/role; for
  // existing accounts we only overwrite full_name when previously blank.
  const { data: currentProfile } = await admin
    .from("profiles_with_role")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const cp = currentProfile as {
    full_name: string | null;
    primary_role_id: string | null;
  } | null;

  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: cp?.full_name?.trim() ? cp.full_name : trimmedName,
      primary_role_id: cp?.primary_role_id ?? roleId,
      is_onboarded: true,
    },
    { onConflict: "id" }
  );
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );
  if (roleErr) {
    // Only delete the auth user if we just created them in this request.
    if (mode === "invited") {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  console.log(`[admin/users] ${mode} ${trimmedEmail} (${role})`);

  return NextResponse.json({
    user: {
      id: userId,
      email: trimmedEmail,
      displayName: trimmedName,
      role,
    },
    invited: mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
