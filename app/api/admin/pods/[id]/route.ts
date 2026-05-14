/*
 * Pod admin API — rename or archive.
 *
 * PATCH /api/admin/pods/[id]
 *   Body: { name?: string, archived?: boolean }
 *   Renames the pod and/or sets/clears archived_at. Returns updated row.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    archived?: boolean;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: "Pod name cannot be empty." }, { status: 400 });
    patch.name = trimmed;
  }
  if (typeof body.archived === "boolean") {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 1) {
    // Only updated_at — nothing to actually change.
    return NextResponse.json({ error: "No changes provided." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("pods")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Pod not found." }, { status: 404 });
  }
  return NextResponse.json({ pod: data });
}
