/*
 * POST /api/contract/accept
 *   Body: { quoteId }
 *   Customer accepts a quoted estimate WITHOUT an online payment — the
 *   contract is committed (status='committed', committed_at) and the
 *   project's engagement type is flipped, exactly like the paid commit
 *   path, but with no Stripe step. Billing is arranged off-platform
 *   (the appointment flow + the team handle it). Idempotent — a repeat
 *   call on an already-committed quote is a no-op.
 *
 * Mirrors /api/contract/commit but drops the PaymentIntent verification.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { quoteId } = (await request.json().catch(() => ({}))) as { quoteId?: string };
  if (!quoteId) return NextResponse.json({ error: "Missing quoteId." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: q } = await admin
    .from("project_quote_requests")
    .select("id, customer_user_id, status, kind, project_id")
    .eq("id", quoteId).maybeSingle();
  const quote = q as { customer_user_id: string; status: string; kind: string; project_id: string } | null;
  if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  if (quote.customer_user_id !== user.id) return NextResponse.json({ error: "Not your quote." }, { status: 403 });
  if (quote.status === "committed") return NextResponse.json({ ok: true, alreadyCommitted: true });
  if (quote.status !== "quoted") return NextResponse.json({ error: "Quote isn't open." }, { status: 409 });

  const { error } = await admin
    .from("project_quote_requests")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Commit flips the project's engagement type, so engineer/pod golive +
  // maintain KPIs reflect the new contract. (Same as the paid path.)
  if (quote.kind === "golive" || quote.kind === "maintain") {
    await admin.from("projects").update({ contract_type: quote.kind }).eq("id", quote.project_id);
  }

  return NextResponse.json({ ok: true });
}
