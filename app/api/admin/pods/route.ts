/*
 * Pods admin API — list + create.
 *
 * GET  /api/admin/pods
 *   Returns every non-archived pod with its members (supervisor + engineer
 *   rows enriched with email + display_name).
 *
 * POST /api/admin/pods
 *   Body: { name, description? }
 *   Creates a new pod with auto-generated slug. Returns the new row.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data: pods, error: podsErr } = await admin
    .from("pods")
    .select("id, name, slug, description, created_at, archived_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (podsErr)
    return NextResponse.json({ error: podsErr.message }, { status: 500 });

  if (!pods || pods.length === 0) {
    return NextResponse.json({ pods: [] });
  }

  const podIds = pods.map((p) => p.id);

  // Pull every member row for the visible pods in one query.
  const { data: members } = await admin
    .from("pod_members")
    .select("id, pod_id, user_id, pod_role, added_at")
    .in("pod_id", podIds);

  const memberUserIds = [...new Set((members ?? []).map((m) => m.user_id))];

  // Resolve display name (profiles) + email (auth.users) for each member.
  const [{ data: profiles }, { data: authPage }] = await Promise.all([
    memberUserIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", memberUserIds)
      : Promise.resolve({ data: [] }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const profileMap = new Map<string, string>();
  for (const p of (profiles ?? []) as {
    id: string;
    full_name: string | null;
  }[]) {
    if (p.full_name) profileMap.set(p.id, p.full_name);
  }
  const emailMap = new Map<string, string>();
  for (const u of authPage?.users ?? []) {
    if (u.email) emailMap.set(u.id, u.email);
  }

  const membersByPod = new Map<string, ReturnType<typeof formatMember>[]>();
  for (const m of members ?? []) {
    const list = membersByPod.get(m.pod_id) ?? [];
    list.push(formatMember(m, profileMap, emailMap));
    membersByPod.set(m.pod_id, list);
  }

  return NextResponse.json({
    pods: pods.map((p) => {
      const members = membersByPod.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        createdAt: p.created_at,
        supervisors: members.filter((m) => m.podRole === "supervisor"),
        engineers: members.filter((m) => m.podRole === "engineer"),
      };
    }),
  });
}

function formatMember(
  m: { id: string; user_id: string; pod_role: string; added_at: string },
  profileMap: Map<string, string>,
  emailMap: Map<string, string>
) {
  return {
    id: m.id,
    userId: m.user_id,
    podRole: m.pod_role,
    addedAt: m.added_at,
    email: emailMap.get(m.user_id) ?? "",
    displayName: profileMap.get(m.user_id) ?? "",
  };
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { name, description } = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };

  const trimmedName = name?.trim();
  if (!trimmedName) {
    return NextResponse.json(
      { error: "Pod name is required." },
      { status: 400 }
    );
  }

  // Auto-slug from name. We append a short suffix if there's a collision.
  const baseSlug =
    trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "pod";

  // Loop until insert succeeds — at most 100 attempts.
  let slug = baseSlug;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { data: pod, error } = await admin
      .from("pods")
      .insert({
        name: trimmedName,
        slug,
        description: description?.trim() || null,
        created_by: actor.id,
      })
      .select()
      .single();

    if (!error && pod) {
      return NextResponse.json({ pod: serialize(pod) });
    }

    // Duplicate slug → try next suffix
    if (error?.code === "23505" && error.message.includes("slug")) {
      slug = `${baseSlug}-${attempt + 1}`;
      continue;
    }

    return NextResponse.json(
      { error: error?.message ?? "Couldn't create pod." },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: "Couldn't allocate a unique slug." },
    { status: 500 }
  );
}

type PodRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
};

function serialize(p: PodRow) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    createdAt: p.created_at,
    supervisors: [],
    engineers: [],
  };
}
