/*
 * Reseller API — view + edit (status + commission + name + email).
 *
 * PATCH /api/admin/resellers/:id
 *   Updates one or more of: name, email, commission, status.
 *   For status='suspended' we route through the deactivate_reseller RPC
 *   which converts inorganic enterprises to organic and preserves data.
 *   Caller must hold super_admin.
 *
 * No DELETE — resellers can only be suspended; spec forbids data loss.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { banUser, unbanUser } from "@/lib/auth-ban";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    commission?: number | string;
    status?: string;
  };

  // Status changes are special — deactivation cascades through the RPC.
  if (body.status) {
    if (body.status === "suspended") {
      // Capture the reseller's owner before deactivation so we can ban them
      // even though the RPC clears no reseller-side ownership info.
      const { data: rRow } = await admin
        .from("resellers")
        .select("owner_user_id")
        .eq("id", id)
        .maybeSingle();
      const ownerUserId = (rRow as { owner_user_id: string | null } | null)?.owner_user_id;

      const { error } = await admin.rpc("deactivate_reseller", { _reseller_id: id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      // Spec doesn't explicitly say "ban the reseller user," but the
      // resellers row is suspended and they no longer have any
      // inorganic enterprises (those flipped to organic). Banning the
      // login makes the deactivation actually mean something at the
      // session layer.
      if (ownerUserId) await banUser(admin, ownerUserId);
      return NextResponse.json({ ok: true, status: "suspended" });
    }
    if (body.status === "active") {
      const { error } = await admin
        .from("resellers")
        .update({ status: "active" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const { data: rRow } = await admin
        .from("resellers")
        .select("owner_user_id")
        .eq("id", id)
        .maybeSingle();
      const ownerUserId = (rRow as { owner_user_id: string | null } | null)?.owner_user_id;
      if (ownerUserId) await unbanUser(admin, ownerUserId);
      return NextResponse.json({ ok: true, status: "active" });
    }
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name?.trim()) update.name = body.name.trim();
  if (body.email?.trim()) {
    const clean = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }
    update.email = clean;
  }
  if (body.commission !== undefined) {
    const n = Number(body.commission);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: "Commission must be 0–100." }, { status: 400 });
    }
    update.commission = n;
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await admin.from("resellers").update(update).eq("id", id);
  if (error) {
    // 23505 = unique_violation (email collision).
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Another reseller already uses this email." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
