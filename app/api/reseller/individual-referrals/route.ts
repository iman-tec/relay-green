/*
 * GET /api/reseller/individual-referrals
 *
 * The partner's Individual-referrals ledger — standalone individuals who signed
 * up via the partner's ?ref link, separate from the enterprise companies table.
 * Returns, per referred individual: when referred, status, the discount they
 * get, and the partner's accrued commission (summed from the dated
 * referral_commission_entries ledger). Plus portfolio totals.
 *
 * Privacy: the referred individual is a standalone customer, NOT the partner's
 * employee — so NO name/email/usage detail is exposed. Each row carries only an
 * opaque handle, dates, rates, and money. Reseller-scoped + flag-gated.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReferralRow = {
  id: string;
  customer_user_id: string;
  status: string;
  discount_pct_applied: number | string;
  commission_pct_applied: number | string;
  referred_at: string;
};

type EntryRow = {
  customer_user_id: string;
  commission_cents: number | string;
  occurred_at: string;
};

export async function GET() {
  if (!partnerProgramEnabled()) {
    return NextResponse.json(
      { error: "not_enabled" },
      { status: 404 }
    );
  }

  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { data: refRows, error: refErr } = await admin
    .from("individual_referrals")
    .select(
      "id, customer_user_id, status, discount_pct_applied, commission_pct_applied, referred_at"
    )
    .eq("reseller_id", resellerId)
    .order("referred_at", { ascending: false });
  if (refErr)
    return NextResponse.json({ error: refErr.message }, { status: 500 });

  const referrals = (refRows ?? []) as ReferralRow[];

  // Accrued commission per individual, from the dated ledger.
  const { data: entryRows, error: entErr } = await admin
    .from("referral_commission_entries")
    .select("customer_user_id, commission_cents, occurred_at")
    .eq("reseller_id", resellerId);
  if (entErr)
    return NextResponse.json({ error: entErr.message }, { status: 500 });

  const accruedByUser = new Map<string, number>();
  const lastAccrualByUser = new Map<string, string>();
  for (const e of (entryRows ?? []) as EntryRow[]) {
    accruedByUser.set(
      e.customer_user_id,
      (accruedByUser.get(e.customer_user_id) ?? 0) + Number(e.commission_cents)
    );
    const prev = lastAccrualByUser.get(e.customer_user_id);
    if (!prev || e.occurred_at > prev)
      lastAccrualByUser.set(e.customer_user_id, e.occurred_at);
  }

  const items = referrals.map((r) => ({
    id: r.id,
    // Opaque, stable handle — never the individual's name/email.
    handle: `Individual ${r.customer_user_id.slice(0, 4).toUpperCase()}`,
    status: r.status,
    discountPct: Number(r.discount_pct_applied),
    commissionPct: Number(r.commission_pct_applied),
    referredAt: r.referred_at,
    accruedCommissionCents: accruedByUser.get(r.customer_user_id) ?? 0,
    lastAccrualAt: lastAccrualByUser.get(r.customer_user_id) ?? null,
  }));

  const totals = {
    count: items.length,
    active: items.filter((i) => i.status === "active").length,
    accruedCommissionCents: items.reduce(
      (s, i) => s + i.accruedCommissionCents,
      0
    ),
  };

  return NextResponse.json({ referrals: items, totals });
}
