/*
 * Resellers API — list + create.
 *
 * GET  /api/admin/resellers
 *   Returns all resellers with computed enterprise counts. Caller must
 *   hold super_admin.
 *
 * POST /api/admin/resellers
 *   Creates a reseller row, an auth user for the contact email, links
 *   the profile to the reseller, grants the reseller role, optionally
 *   transfers the initial minutes allocation, and sends an invitation
 *   email via the Supabase invite-by-email path.
 *
 *   Body: { name, email, commission?, allocatedMinutes? }
 *   Returns: { reseller, contact, invited, attachedExisting }
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { provisionReseller } from "@/lib/reseller-provision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResellerRow = {
  id: string;
  name: string;
  email: string | null;
  reseller_code: string;
  commission: number;
  allocated_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  status: string;
  owner_user_id: string | null;
  created_at: string;
};

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data: resellers, error } = await admin
    .from("resellers")
    .select(
      "id, name, email, reseller_code, commission, allocated_minutes, used_minutes, remaining_minutes, status, owner_user_id, created_at"
    )
    .order("created_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (!resellers || !resellers.length) {
    return NextResponse.json({ resellers: [] });
  }

  // Per-reseller enterprise list (full org rows for the right-pane detail
  // view) + rolled-up counts. One query, then group by reseller_id.
  const ids = resellers.map((r: ResellerRow) => r.id);
  const { data: orgRows } = await admin
    .from("organizations")
    .select(
      "id, name, primary_domain, status, enterprise_code, reseller_id, allocated_minutes, used_minutes, remaining_minutes, created_at"
    )
    .in("reseller_id", ids)
    .order("created_at", { ascending: false });

  type OrgRow = {
    id: string;
    name: string;
    primary_domain: string | null;
    status: string;
    enterprise_code: string;
    reseller_id: string;
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
    created_at: string;
  };
  const orgs = (orgRows ?? []) as OrgRow[];

  const counts = new Map<string, { total: number; active: number }>();
  const enterprisesByReseller = new Map<
    string,
    ReturnType<typeof formatEnterprise>[]
  >();
  for (const o of orgs) {
    const c = counts.get(o.reseller_id) ?? { total: 0, active: 0 };
    c.total += 1;
    if (o.status === "active") c.active += 1;
    counts.set(o.reseller_id, c);

    const list = enterprisesByReseller.get(o.reseller_id) ?? [];
    list.push(formatEnterprise(o));
    enterprisesByReseller.set(o.reseller_id, list);
  }

  return NextResponse.json({
    resellers: (resellers as ResellerRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      resellerCode: r.reseller_code,
      commission: Number(r.commission ?? 0),
      allocatedMinutes: Number(r.allocated_minutes ?? 0),
      usedMinutes: Number(r.used_minutes ?? 0),
      remainingMinutes: Number(r.remaining_minutes ?? 0),
      status: r.status,
      ownerUserId: r.owner_user_id,
      totalEnterprises: counts.get(r.id)?.total ?? 0,
      activeEnterprises: counts.get(r.id)?.active ?? 0,
      enterprises: enterprisesByReseller.get(r.id) ?? [],
      createdAt: r.created_at,
    })),
  });
}

type EnterpriseDbRow = {
  id: string;
  name: string;
  primary_domain: string | null;
  status: string;
  enterprise_code: string;
  allocated_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  created_at: string;
};

function formatEnterprise(o: EnterpriseDbRow) {
  return {
    id: o.id,
    name: o.name,
    primaryDomain: o.primary_domain,
    status: o.status,
    enterpriseCode: o.enterprise_code,
    allocatedMinutes: Number(o.allocated_minutes ?? 0),
    usedMinutes: Number(o.used_minutes ?? 0),
    remainingMinutes: Number(o.remaining_minutes ?? 0),
    createdAt: o.created_at,
  };
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { name, email, commission, allocatedMinutes } = (await request
    .json()
    .catch(() => ({}))) as {
    name?: string;
    email?: string;
    commission?: number | string;
    allocatedMinutes?: number | string;
  };

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json(
      { error: "Need name and email." },
      { status: 400 }
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  // Commission defaults to 20% when the creator leaves it blank.
  const commissionNum =
    commission === undefined || commission === "" ? 20 : Number(commission);
  if (Number.isNaN(commissionNum) || commissionNum < 0 || commissionNum > 100) {
    return NextResponse.json(
      { error: "Commission must be between 0 and 100." },
      { status: 400 }
    );
  }

  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json(
      { error: "Allocation must be non-negative." },
      { status: 400 }
    );
  }

  // Provision via the shared path. onExisting:"error" keeps the manual-create
  // duplicate-email guard (409) — the partner-application approve route reuses
  // the same function with onExisting:"link".
  const result = await provisionReseller(admin, {
    name: name.trim(),
    email: cleanEmail,
    commission: commissionNum,
    allocatedMinutes: allocNum,
    actorId: actor.id,
    onExisting: "error",
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    reseller: result.reseller,
    contact: {
      id: result.userId,
      email: cleanEmail,
      displayName: name.trim(),
    },
    invited: result.mode === "invited",
    attachedExisting: result.mode === "attached_existing",
  });
}
