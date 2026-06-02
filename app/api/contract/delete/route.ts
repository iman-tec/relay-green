/*
 * POST /api/contract/delete
 *   Body: { quoteId }
 *   Customer removes a bid request from their list permanently. Allowed for
 *   any non-active request (pending / quoted / declined / cancelled). An
 *   active contract ('committed') is a live obligation and is NOT deletable
 *   from the customer side. Idempotent — deleting an already-gone row is a
 *   no-op.
 *
 *   supervisor_bookings.quote_id is ON DELETE SET NULL, so removing the quote
 *   won't FK-block an existing appointment (its quote link just nulls out).
 *
 * Mirrors /api/contract/accept (service-role admin write — RLS exposes no
 * customer DELETE policy on project_quote_requests).
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { quoteId, reason } = (await request.json().catch(() => ({}))) as {
    quoteId?: string;
    reason?: string;
  };
  if (!quoteId)
    return NextResponse.json({ error: "Missing quoteId." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: q } = await admin
    .from("project_quote_requests")
    .select("id, customer_user_id, status")
    .eq("id", quoteId)
    .maybeSingle();
  const quote = q as { customer_user_id: string; status: string } | null;
  // Already gone — treat as success so a double-click / realtime race is benign.
  if (!quote) return NextResponse.json({ ok: true, alreadyGone: true });
  if (quote.customer_user_id !== user.id)
    return NextResponse.json({ error: "Not your quote." }, { status: 403 });
  if (quote.status === "committed")
    return NextResponse.json(
      { error: "An active contract can't be deleted." },
      { status: 409 }
    );

  // The row is about to be removed, so the customer's reason can't live on it.
  // Log it for product telemetry (a feedback store can pick this up later).
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason)
    console.info(
      `[contract/delete] quote=${quoteId} reason=${JSON.stringify(trimmedReason)}`
    );

  const { error } = await admin
    .from("project_quote_requests")
    .delete()
    .eq("id", quoteId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
