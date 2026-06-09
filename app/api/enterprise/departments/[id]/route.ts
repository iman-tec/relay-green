/*
 * Enterprise-scoped department — edit / activate / deactivate.
 *
 * PATCH /api/enterprise/departments/:id
 *   Body: any subset of { name, status }
 *   Status semantics:
 *     - 'suspended' → calls deactivate_department RPC (cascades through
 *                     employees + returns dept remainder to enterprise) +
 *                     bans every dept user (admin + members) so login is gated.
 *     - 'active'    → flip dept back AND cascade reactivation to every member
 *                     (unban + clear profiles.status='suspended') so the dept is
 *                     usable again. Minutes are NOT auto-restored (they were
 *                     refunded to the pool on suspend); the admin refills.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { banUsers, unbanUsers } from "@/lib/auth-ban";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id } = await params;

  // Ownership guard.
  const { data: owned } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", id)
    .maybeSingle();
  if (!owned || (owned as { enterprise_id: string }).enterprise_id !== orgId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    status?: string;
  };

  if (body.status) {
    if (body.status === "suspended") {
      // Collect every profile attached to this dept (employees + admin)
      // BEFORE the RPC fires; the cascade itself doesn't touch auth users.
      const { data: members } = await admin
        .from("profiles")
        .select("id")
        .eq("department_id", id);
      const memberIds = (members ?? []).map((m: { id: string }) => m.id);

      const { error } = await admin.rpc("deactivate_department", {
        _dept_id: id,
      });
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });

      await banUsers(admin, memberIds);
      return NextResponse.json({ ok: true, status: "suspended" });
    }
    if (body.status === "active") {
      const { error } = await admin
        .from("departments")
        .update({ status: "active" })
        .eq("id", id);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });
      // Cascade reactivation to EVERY dept user (admin + members): lift the auth
      // ban + clear profiles.status='suspended' so the department is usable
      // again. Member lifecycle status is derived from the ban + last_sign_in,
      // so unbanning restores Active/Invited automatically; the status column is
      // reset too for the refill guard + any column readers. Minutes stay where
      // they were refunded on suspend — the admin refills as needed.
      const { data: members } = await admin
        .from("profiles")
        .select("id")
        .eq("department_id", id);
      const memberIds = (members ?? []).map((m: { id: string }) => m.id);
      await unbanUsers(admin, memberIds);
      if (memberIds.length) {
        await admin
          .from("profiles")
          .update({ status: "active" })
          .in("id", memberIds);
      }
      return NextResponse.json({ ok: true, status: "active" });
    }
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name?.trim()) update.name = body.name.trim();
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error } = await admin.from("departments").update(update).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Another department already uses this name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
