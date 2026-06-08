/*
 * POST /api/admin/partner-applications/[id]/reject — polite decline.
 *
 * Atomically marks the application 'rejected' (claim RPC, single-fire) and
 * sends the applicant a courteous decline email. No silent drop. Idempotent: a
 * second reject is a no-op success.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendResendEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AppRow = {
  id: string;
  contact_name: string;
  work_email: string;
  company_name: string;
  status: string;
};

function declineText(contactName: string): string {
  return [
    `Hi ${contactName},`,
    "",
    "Thank you for your interest in the Relay Channel Partner program and for " +
      "taking the time to apply.",
    "",
    "After reviewing your application, we're not able to move forward with a " +
      "partnership at this time. This isn't a reflection of your business — our " +
      "program capacity and fit criteria are narrow right now, and that's on us.",
    "",
    "You're welcome to apply again as your practice grows, and you can always " +
      "reach us at partners@relay.green if you'd like to talk it through.",
    "",
    "Wishing you the best,",
    "— The Relay partnerships team",
  ].join("\n");
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;
  const { id } = await params;

  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_partner_application",
    { _id: id, _status: "rejected", _reviewer: actor.id }
  );
  if (claimErr)
    return NextResponse.json({ error: claimErr.message }, { status: 500 });

  const row = (claimed as AppRow[] | null)?.[0] ?? null;

  if (!row) {
    // Didn't win the claim. Idempotent if already rejected; otherwise conflict.
    const { data: current } = await admin
      .from("partner_applications")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    const cur = current as { id: string; status: string } | null;
    if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (cur.status === "rejected")
      return NextResponse.json({ ok: true, alreadyRejected: true });
    return NextResponse.json(
      { error: `Application is '${cur.status}', cannot reject.` },
      { status: 409 }
    );
  }

  // Best-effort decline email — the status change already stuck.
  const { sent } = await sendResendEmail({
    to: row.work_email,
    subject: "An update on your Relay partner application",
    text: declineText(row.contact_name),
  });

  return NextResponse.json({ ok: true, declineEmailSent: sent });
}
