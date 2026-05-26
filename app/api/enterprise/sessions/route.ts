/*
 * GET /api/enterprise/sessions?limit=50&since=2025-12-01
 *
 * Recent sessions scoped to the caller's org. Used by the dashboard's
 * "Recent sessions" table and the daily-sessions sparkline.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const since = url.searchParams.get("since");

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("organization_id", orgId);
  const profileIds = ((profiles ?? []) as Array<{ id: string; full_name: string | null }>)
    .map((p) => p.id);
  const nameById = new Map<string, string>(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null }>)
      .map((p) => [p.id, p.full_name ?? ""]),
  );

  if (profileIds.length === 0) return NextResponse.json({ sessions: [] });

  // GDPR data-minimization: the enterprise mgmt dashboard does NOT receive
  // customer email or AI summary content (session content). We select only
  // what the management views render — names are allowed for the admin's own
  // org, email + summary are not. See docs/gdpr-data-access-matrix.md.
  type SessionRow = {
    id: string; status: string; urgency: string | null; recall_count: number | null;
    created_at: string; joined_at: string | null; ended_at: string | null;
    duration_minutes: number | null;
    customer_user_id: string | null; claimed_by: string | null;
    guest_name: string | null;
    project_name: string | null;
  };

  const orFilter = profileIds.length > 0
    ? `organization_id.eq.${orgId},customer_user_id.in.(${profileIds.join(",")})`
    : `organization_id.eq.${orgId}`;
  let q = admin
    .from("guest_calls")
    .select("id,status,urgency,recall_count,created_at,joined_at,ended_at,duration_minutes,customer_user_id,claimed_by,guest_name,project_name")
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);

  const { data: rawRows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (rawRows ?? []) as unknown as SessionRow[];

  // Engineer names — claimed_by may reference platform staff outside the
  // org's profile set; fetch separately.
  const engineerIds = Array.from(
    new Set(rows.map((r) => r.claimed_by).filter(Boolean) as string[]),
  );
  const engineerNames = new Map<string, string>();
  if (engineerIds.length > 0) {
    const { data: engs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", engineerIds);
    for (const e of (engs ?? []) as Array<{ id: string; full_name: string | null }>) {
      engineerNames.set(e.id, e.full_name ?? "");
    }
  }

  const CENTS_PER_MINUTE = 300;
  const sessions = rows.map((r) => ({
    id:             r.id,
    status:         r.status,
    urgency:        r.urgency ?? "normal",
    recallCount:    r.recall_count ?? 0,
    createdAt:      r.created_at,
    joinedAt:       r.joined_at,
    endedAt:        r.ended_at,
    durationMinutes:r.duration_minutes,
    chargeCents:    r.duration_minutes ? Math.round(Number(r.duration_minutes) * CENTS_PER_MINUTE) : null,
    customerName:   r.guest_name || nameById.get(r.customer_user_id ?? "") || "",
    engineerName:   r.claimed_by ? engineerNames.get(r.claimed_by) ?? "" : "",
    projectName:    r.project_name ?? null,
    // customerEmail + summaryTitle intentionally omitted — GDPR minimization.
  }));

  return NextResponse.json({ sessions });
}
