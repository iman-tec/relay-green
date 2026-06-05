/*
 * Pod member admin API — remove a user from a pod.
 *
 * DELETE /api/admin/pods/[id]/members/[userId]
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id: podId, userId } = await params;

  const { error, count } = await admin
    .from("pod_members")
    .delete({ count: "exact" })
    .eq("pod_id", podId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count || count === 0) {
    return NextResponse.json(
      { error: "Member not found in this pod." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
