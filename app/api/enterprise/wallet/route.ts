/*
 * GET /api/enterprise/wallet
 *
 * The company's prepaid minute wallet snapshot: pooled minutes (bought),
 * used, remaining, and how much is currently distributed to departments.
 * Pay-per-minute — there is no subscription here.
 *
 * Caller must be an enterprise_admin.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { MINUTE_BUNDLES, LIST_CENTS_PER_MINUTE } from "@/lib/billing/minuteBundles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data: org, error } = await admin
    .from("organizations")
    .select("allocated_minutes, used_minutes, remaining_minutes, billing_currency")
    .eq("id", orgId)
    .single();
  if (error || !org) {
    return NextResponse.json({ error: error?.message ?? "Org not found." }, { status: 404 });
  }
  const o = org as { allocated_minutes: number; used_minutes: number; remaining_minutes: number; billing_currency: string | null };

  // Minutes currently parcelled out to departments.
  const { data: depts } = await admin
    .from("departments")
    .select("allocated_minutes")
    .eq("enterprise_id", orgId);
  const distributedMinutes = ((depts ?? []) as Array<{ allocated_minutes: number }>)
    .reduce((s, d) => s + Number(d.allocated_minutes ?? 0), 0);

  return NextResponse.json({
    currency:            o.billing_currency ?? "eur",
    allocatedMinutes:    Number(o.allocated_minutes ?? 0),
    usedMinutes:         Number(o.used_minutes ?? 0),
    remainingMinutes:    Number(o.remaining_minutes ?? 0),
    distributedMinutes,
    perMinuteCents:      LIST_CENTS_PER_MINUTE,
    bundles:             MINUTE_BUNDLES,
  });
}
