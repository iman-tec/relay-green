/*
 * GDPR right-to-erasure for an enterprise member.
 *
 * POST /api/enterprise/members/:id/erase
 *   Marks the profile erased + strips PII (full_name, avatar_url). Keeps
 *   the profile row (and any FK pointing to it from sessions / billing)
 *   so aggregate counts and reconciliation are preserved. The UI renders
 *   "Erased member" whenever erased_at is non-null.
 *
 *   Refuses if:
 *     - the member is not in the caller's org   → 404
 *     - the member is the caller themselves     → 400
 *     - the member is already erased            → 200 idempotent no-op
 *
 *   Out of scope (later phases):
 *     - Hard-delete of session message bodies / attachments. Those are
 *       governed by retention_days in a future sweeper.
 *     - Auth user disablement (auth.users row stays — we still need it
 *       to enforce sign-in blocks if the org chooses).
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  if (id === actor.id)
    return NextResponse.json({ error: "cannot_erase_self" }, { status: 400 });

  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id, full_name, erased_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string | null;
      full_name: string | null;
      erased_at: string | null;
    }>();

  if (!target || target.organization_id !== orgId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (target.erased_at) {
    // Already erased — treat as success so the UI doesn't have to special-case.
    return NextResponse.json({
      ok: true,
      member: { id: target.id, erasedAt: target.erased_at, fullName: null },
      alreadyErased: true,
    });
  }

  const { data: updated, error } = await admin
    .from("profiles")
    .update({
      full_name: null,
      avatar_url: null,
      erased_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id, erased_at")
    .single<{ id: string; erased_at: string }>();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    member: { id: updated.id, erasedAt: updated.erased_at, fullName: null },
    alreadyErased: false,
  });
}
