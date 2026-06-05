/*
 * Reseller-scoped enterprise — edit / activate / deactivate.
 *
 * PATCH /api/reseller/enterprises/:id
 *   Body: any subset of { name, primaryDomain, status }
 *   Status semantics:
 *     - 'suspended' → calls deactivate_enterprise RPC (freeze, no refund)
 *     - 'active'    → direct status flip back
 *
 *   The route refuses to operate on an enterprise that isn't owned by
 *   the calling reseller (defence-in-depth alongside the RLS policies).
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { banUsers } from "@/lib/auth-ban";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { id } = await params;

  const { data: owned } = await admin
    .from("organizations")
    .select("id, reseller_id")
    .eq("id", id)
    .maybeSingle();
  if (
    !owned ||
    (owned as { reseller_id: string | null }).reseller_id !== resellerId
  ) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    primaryDomain?: string;
    status?: string;
  };

  if (body.status) {
    if (body.status === "suspended") {
      // Per spec: "freeze enterprise data, freeze balances, disable access".
      // The RPC only flips org.status; we ban every member's auth row so
      // none of them can sign in.
      const { data: members } = await admin
        .from("profiles")
        .select("id")
        .eq("organization_id", id);
      const memberIds = (members ?? []).map((m: { id: string }) => m.id);

      const { error } = await admin.rpc("deactivate_enterprise", {
        _org_id: id,
      });
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });

      await banUsers(admin, memberIds);
      return NextResponse.json({ ok: true, status: "suspended" });
    }
    if (body.status === "active") {
      const { error } = await admin
        .from("organizations")
        .update({ status: "active" })
        .eq("id", id);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });
      // No automatic cascade reactivation — admins re-enable individual
      // members as needed.
      return NextResponse.json({ ok: true, status: "active" });
    }
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name?.trim()) update.name = body.name.trim();
  if (body.primaryDomain !== undefined) {
    update.primary_domain = body.primaryDomain.trim() || null;
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error } = await admin
    .from("organizations")
    .update(update)
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
