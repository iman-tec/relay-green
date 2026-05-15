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
import { applySearch, listResponse, parseListQuery } from "@/lib/api/list-query";

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

// Sortable columns map to actual `profiles` columns (the table we paginate
// against). Search runs an ilike on `full_name` (trigram-indexed) and we
// merge in the email match after fetching auth rows for the page.
const SORTABLE = ["displayName", "createdAt", "primaryRole"] as const;
type SortKey = (typeof SORTABLE)[number];
const SORT_COLUMN_MAP: Record<SortKey, string> = {
  displayName: "full_name",
  createdAt:   "created_at",
  primaryRole: "primary_role",
};

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const url   = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "staff";
  const list  = parseListQuery(url, {
    sortable:    SORTABLE,
    defaultSort: { column: "createdAt", dir: "desc" },
    filters:     ["role"] as const,
    defaultPageSize: 25,
  });

  // 1. Scope the universe via user_roles. Staff = anyone with a staff role
  //    (or filtered to a specific staff role); non-staff = everyone else.
  let staffUserIds: string[] | null = null;
  if (scope === "staff" || list.filters.role) {
    let rq = admin.from("user_roles").select("user_id");
    if (list.filters.role) {
      rq = rq.eq("role", list.filters.role);
    } else {
      rq = rq.in("role", Array.from(STAFF_ROLES));
    }
    const { data: roleScope, error: roleErr } = await rq;
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }
    staffUserIds = Array.from(new Set((roleScope ?? []).map((r: { user_id: string }) => r.user_id)));
  }

  // 2. Paginated profiles query — pulls just the page slice (≤ pageSize).
  let pq = admin
    .from("profiles")
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
      .from("user_roles")
      .select("user_id")
      .in("role", Array.from(STAFF_ROLES));
    const excludeIds = Array.from(new Set((staffOnly ?? []).map((r: { user_id: string }) => r.user_id)));
    if (excludeIds.length > 0) {
      pq = pq.not("id", "in", `(${excludeIds.join(",")})`);
    }
  }

  pq = applySearch(pq, list.q, ["full_name"]);

  if (list.sort) {
    const col = SORT_COLUMN_MAP[list.sort.column as SortKey];
    pq = pq.order(col, { ascending: list.sort.dir === "asc", nullsFirst: false });
  }
  pq = pq.range(list.range[0], list.range[1]);

  const { data: profiles, count, error: profErr } = await pq;
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  const pageIds = (profiles ?? []).map((p: { id: string }) => p.id);

  if (pageIds.length === 0) {
    return NextResponse.json(listResponse([], count ?? 0, list.page, list.pageSize));
  }

  // 3. Roles + auth-side meta (email, banned_until, email_confirmed_at)
  //    for JUST the page slice. user_meta_for_admin RPC joins auth.users
  //    by id — far cheaper than listUsers({ perPage: 1000 }).
  const [{ data: roleRows }, { data: metaRows }] = await Promise.all([
    admin.from("user_roles").select("user_id, role").in("user_id", pageIds),
    admin.rpc("user_meta_for_admin", { _ids: pageIds }),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  }
  type Meta = { id: string; email: string | null; banned_until: string | null; email_confirmed_at: string | null };
  const metaById = new Map<string, Meta>();
  for (const m of (metaRows ?? []) as Meta[]) {
    metaById.set(m.id, m);
  }

  const now = Date.now();
  const rows = (profiles ?? []).map((p: { id: string; full_name: string | null; primary_role: string | null; created_at: string }) => {
    const m = metaById.get(p.id);
    const banned = !!(m?.banned_until && new Date(m.banned_until).getTime() > now);
    return {
      id:                  p.id,
      email:               m?.email ?? "",
      displayName:         p.full_name ?? "",
      roles:               rolesByUser.get(p.id) ?? [],
      primaryRole:         p.primary_role ?? null,
      status:              banned ? "DEACTIVATED" : "ACTIVE",
      awaitingFirstSignIn: !m?.email_confirmed_at,
      createdAt:           p.created_at,
    };
  });

  return NextResponse.json(listResponse(rows, count ?? 0, list.page, list.pageSize));
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
