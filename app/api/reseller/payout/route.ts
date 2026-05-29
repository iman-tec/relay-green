/*
 * Reseller payout details.
 *
 * GET /api/reseller/payout    → { payoutEmail: string | null }
 * PUT /api/reseller/payout    → upsert payoutEmail on resellers.
 *                                Body: { payoutEmail: string | null }
 *                                Empty string clears the field.
 *
 * Validation: when non-empty, must look like an email. Service-role writes
 * are scoped explicitly by reseller_id (RLS would also enforce; defence
 * in depth).
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { data, error } = await admin
    .from("resellers")
    .select("payout_email")
    .eq("id", resellerId)
    .maybeSingle<{ payout_email: string | null }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payoutEmail: data?.payout_email ?? null });
}

export async function PUT(request: Request) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const body = (await request.json().catch(() => ({}))) as { payoutEmail?: string | null };
  const raw = (body.payoutEmail ?? "").trim();
  const next: string | null = raw === "" ? null : raw.toLowerCase();

  if (next != null && !EMAIL.test(next)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const { error } = await admin
    .from("resellers")
    .update({ payout_email: next })
    .eq("id", resellerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payoutEmail: next });
}
