/*
 * Reseller-scoped orgs listing.
 *
 * GET /api/reseller/orgs
 *   Returns enterprises owned by the calling reseller, each with its
 *   departments (department_code, status, minutes, member_count). Mirrors
 *   the shape of /api/admin/orgs but scoped to reseller_id so a reseller
 *   never sees enterprises they don't own.
 *
 *   The redesigned /reseller/v2 panel reads from here for its 2-sidebar
 *   drill-down (enterprise → department → employees). The original
 *   /api/reseller/dashboard returns a flat list with no department data;
 *   we keep that endpoint untouched so the legacy console stays working.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  // Reseller name — for the breadcrumb/header. One round trip, cheap.
  const { data: rRow } = await admin
    .from("resellers")
    .select("id, name, reseller_code, status, commission, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", resellerId)
    .maybeSingle();
  const reseller = rRow as {
    id: string; name: string; reseller_code: string; status: string; commission: number;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number;
  } | null;
  if (!reseller) return NextResponse.json({ error: "reseller row missing" }, { status: 500 });

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, primary_domain, status, enterprise_code, enterprise_type, reseller_id, allocated_minutes, used_minutes, remaining_minutes, created_at")
    .eq("reseller_id", resellerId)
    .order("created_at", { ascending: false });
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });

  type OrgRow = {
    id: string; name: string; primary_domain: string | null; status: string;
    enterprise_code: string; enterprise_type: string;
    reseller_id: string | null;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number;
    created_at: string;
  };
  const orgRows = (orgs ?? []) as OrgRow[];

  if (!orgRows.length) {
    return NextResponse.json({
      reseller: formatReseller(reseller),
      orgs: [],
    });
  }

  const orgIds = orgRows.map((o) => o.id);

  // GDPR: a Channel Partner gets enterprise-level aggregates ONLY — no
  // department breakdown (names, per-department usage, dept-admin ids are all
  // withheld). We expose just a department COUNT per org. See
  // docs/gdpr-data-access-matrix.md.
  const departmentCountByOrg = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: deptRows } = await admin
      .from("departments")
      .select("enterprise_id")
      .in("enterprise_id", orgIds);
    for (const d of (deptRows ?? []) as { enterprise_id: string }[]) {
      departmentCountByOrg.set(d.enterprise_id, (departmentCountByOrg.get(d.enterprise_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    reseller: formatReseller(reseller),
    orgs: orgRows.map((o) => ({
      id:                o.id,
      name:              o.name,
      enterpriseCode:    o.enterprise_code,
      primaryDomain:     o.primary_domain,
      status:            o.status,
      enterpriseType:    o.enterprise_type,
      allocatedMinutes:  Number(o.allocated_minutes ?? 0),
      usedMinutes:       Number(o.used_minutes ?? 0),
      remainingMinutes:  Number(o.remaining_minutes ?? 0),
      createdAt:         o.created_at,
      departmentCount:   departmentCountByOrg.get(o.id) ?? 0,
      // No department breakdown (names / per-dept usage / dept-admin) — GDPR.
    })),
  });
}

function formatReseller(r: {
  id: string; name: string; reseller_code: string; status: string; commission: number;
  allocated_minutes: number; used_minutes: number; remaining_minutes: number;
}) {
  return {
    id:               r.id,
    name:             r.name,
    resellerCode:     r.reseller_code,
    status:           r.status,
    commission:       Number(r.commission ?? 0),
    allocatedMinutes: Number(r.allocated_minutes ?? 0),
    usedMinutes:      Number(r.used_minutes ?? 0),
    remainingMinutes: Number(r.remaining_minutes ?? 0),
  };
}

function formatDepartment(d: {
  id: string; name: string; department_code: string;
  admin_user_id: string | null; status: string;
  allocated_minutes: number; used_minutes: number; remaining_minutes: number;
  created_at: string;
}, memberCount: number) {
  return {
    id:               d.id,
    name:             d.name,
    departmentCode:   d.department_code,
    adminUserId:      d.admin_user_id,
    status:           d.status,
    allocatedMinutes: Number(d.allocated_minutes ?? 0),
    usedMinutes:      Number(d.used_minutes ?? 0),
    remainingMinutes: Number(d.remaining_minutes ?? 0),
    memberCount,
    createdAt:        d.created_at,
  };
}
