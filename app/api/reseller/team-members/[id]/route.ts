/*
 * Remove a team member.
 *
 * DELETE /api/reseller/team-members/:id
 *   Flips status='removed' on the row (soft-delete preserves audit trail).
 *   If the member had a linked profile, we also unset profile.reseller_id
 *   so they lose access to the reseller surface.
 *   Refuses if the row doesn't belong to the caller's reseller.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const { data: existing } = await admin
    .from("reseller_team_members")
    .select("id, reseller_id, user_id, status")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      reseller_id: string;
      user_id: string | null;
      status: string;
    }>();
  if (!existing || existing.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "removed") {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin
    .from("reseller_team_members")
    .update({ status: "removed" })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Detach the profile so they no longer pass requireReseller().
  if (existing.user_id) {
    await admin
      .from("profiles")
      .update({ reseller_id: null })
      .eq("id", existing.user_id)
      .eq("reseller_id", resellerId);
  }

  return NextResponse.json({ ok: true });
}
