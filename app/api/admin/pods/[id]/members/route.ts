/*
 * Pod member admin API — add a user to a pod.
 *
 * POST /api/admin/pods/[id]/members
 *   Body: { userId, podRole: 'supervisor' | 'engineer' }
 *
 * UNIQUE(user_id) on pod_members enforces "one user, one pod". If the
 * caller tries to add someone already in another pod, the insert raises
 * unique_violation (23505) — we catch and return a clear message that
 * names which pod they're already in.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const VALID_ROLES = new Set(["supervisor", "engineer"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id: podId } = await params;
  const { userId, podRole } = (await request.json().catch(() => ({}))) as {
    userId?: string;
    podRole?: string;
  };

  if (!userId || !podRole || !VALID_ROLES.has(podRole)) {
    return NextResponse.json(
      { error: "Need userId and podRole ('supervisor' or 'engineer')." },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("pod_members")
    .insert({ pod_id: podId, user_id: userId, pod_role: podRole })
    .select()
    .single();

  if (error) {
    // unique_violation — user is already in some pod. Tell the admin which.
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("pod_members")
        .select("pod_id")
        .eq("user_id", userId)
        .maybeSingle();
      let existingPodName = "another pod";
      if (existing?.pod_id) {
        const { data: pod } = await admin
          .from("pods")
          .select("name")
          .eq("id", existing.pod_id)
          .maybeSingle();
        if (pod?.name) existingPodName = pod.name;
      }
      return NextResponse.json(
        { error: `This user is already in ${existingPodName}. Remove them from there first.` },
        { status: 409 },
      );
    }
    // check_violation — bad pod_role
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "Invalid pod role. Must be 'supervisor' or 'engineer'." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data });
}
