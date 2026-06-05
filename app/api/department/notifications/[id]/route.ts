/*
 * Mark a single department-admin notification as read.
 *
 * PATCH /api/department/notifications/:id
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(_req: Request, { params }: RouteCtx) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { supabase, user } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
