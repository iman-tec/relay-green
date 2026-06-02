/*
 * POST /api/contract/decline
 *   Body: { quoteId, note? }
 *   Customer rejects a bid they don't want to take. Sets status='declined'
 *   and records the optional customer_response_note so the team can read why
 *   (helps them re-bid). Allowed while the request is still open
 *   (quoted / pending / pending_review) — an active contract ('committed')
 *   can't be declined. Idempotent — a repeat call on an already-declined
 *   quote is a no-op.
 *
 * Mirrors /api/contract/accept (service-role admin write, RLS blocks the
 * direct client UPDATE). The decline_quote() RPC does the same job, but we
 * route through the admin client here for parity with accept and so the
 * feature doesn't depend on that RPC being deployed to the live DB.
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

  const { quoteId, note } = (await request.json().catch(() => ({}))) as {
    quoteId?: string;
    note?: string;
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
  if (!quote)
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  if (quote.customer_user_id !== user.id)
    return NextResponse.json({ error: "Not your quote." }, { status: 403 });
  if (quote.status === "declined")
    return NextResponse.json({ ok: true, alreadyDeclined: true });
  if (quote.status === "committed")
    return NextResponse.json(
      { error: "Contract is already active." },
      { status: 409 }
    );
  if (!["quoted", "pending", "pending_review"].includes(quote.status))
    return NextResponse.json(
      { error: "This bid can't be declined." },
      { status: 409 }
    );

  const trimmed = typeof note === "string" ? note.trim() : "";
  const { error } = await admin
    .from("project_quote_requests")
    .update({ status: "declined", customer_response_note: trimmed || null })
    .eq("id", quoteId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
