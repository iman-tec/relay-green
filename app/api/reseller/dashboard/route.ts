/*
 * Reseller dashboard payload.
 *
 * GET /api/reseller/dashboard
 *   Returns the reseller's own KPI snapshot + a list of all enterprises
 *   they own (inorganic enterprises whose reseller_id matches the caller).
 *   Caller must hold the `reseller` role and have reseller_id set on their
 *   profile.
 *
 *   Output:
 *     {
 *       reseller:  { id, name, code, commission,
 *                    allocatedMinutes, usedMinutes, remainingMinutes,
 *                    totalEnterprises, activeEnterprises, status },
 *       enterprises: [
 *         { id, name, code, status, allocatedMinutes, usedMinutes,
 *           remainingMinutes, createdAt }
 *       ]
 *     }
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const [{ data: r, error: rErr }, { data: orgs, error: oErr }] = await Promise.all([
    admin
      .from("resellers")
      .select(
        "id, name, reseller_code, commission, status, allocated_minutes, used_minutes, remaining_minutes",
      )
      .eq("id", resellerId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select(
        "id, name, enterprise_code, status, allocated_minutes, used_minutes, remaining_minutes, primary_domain, discount_pct, discount_until, created_at",
      )
      .eq("reseller_id", resellerId)
      .order("created_at", { ascending: false }),
  ]);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!r)   return NextResponse.json({ error: "reseller row missing" }, { status: 500 });

  const enterprises = (orgs ?? []) as Array<{
    id:                string;
    name:              string;
    enterprise_code:   string;
    status:            string;
    allocated_minutes: number;
    used_minutes:      number;
    remaining_minutes: number;
    primary_domain:    string | null;
    discount_pct:      number | null;
    discount_until:    string | null;
    created_at:        string;
  }>;

  const total = enterprises.length;
  const active = enterprises.filter((e) => e.status === "active").length;

  return NextResponse.json({
    reseller: {
      id:                (r as { id: string }).id,
      name:              (r as { name: string }).name,
      resellerCode:      (r as { reseller_code: string }).reseller_code,
      commission:        Number((r as { commission: number }).commission ?? 0),
      status:            (r as { status: string }).status,
      allocatedMinutes:  Number((r as { allocated_minutes: number }).allocated_minutes ?? 0),
      usedMinutes:       Number((r as { used_minutes: number }).used_minutes ?? 0),
      remainingMinutes:  Number((r as { remaining_minutes: number }).remaining_minutes ?? 0),
      totalEnterprises:  total,
      activeEnterprises: active,
    },
    enterprises: enterprises.map((e) => ({
      id:                e.id,
      name:              e.name,
      enterpriseCode:    e.enterprise_code,
      status:            e.status,
      primaryDomain:     e.primary_domain,
      allocatedMinutes:  Number(e.allocated_minutes ?? 0),
      usedMinutes:       Number(e.used_minutes ?? 0),
      remainingMinutes:  Number(e.remaining_minutes ?? 0),
      discountPct:       Number(e.discount_pct ?? 0),
      discountUntil:     e.discount_until,
      createdAt:         e.created_at,
    })),
  });
}
