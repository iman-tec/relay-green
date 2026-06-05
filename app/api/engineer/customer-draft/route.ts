/*
 * POST /api/engineer/customer-draft
 *
 * Engineer-side handoff: returns (and consumes) the customer's pre-session
 * prep text — what they wrote in the "Tell the engineer what you're working
 * on" panel before ringing. Body: { sessionId }.
 *
 * Why this exists as an API route instead of the engineer_fetch_customer_draft
 * RPC: that SECURITY DEFINER function shipped with a wrong column reference
 * (gc.customer_id — guest_calls has no such column; it's customer_user_id), so
 * it raised at runtime and the handoff silently no-op'd. Fixing the function
 * needs DDL on the live DB (a Postgres password / management token we don't
 * have in this environment), but the customer's draft lives in
 * customer_session_drafts behind RLS that only the customer can read. The
 * service-role key CAN read it, so we replicate the RPC's logic here:
 *   1. JWT auth via @/lib/supabase/server (cookie-bound). 401 if absent.
 *   2. Load the session; authorize the caller (claimed engineer OR a
 *      supervisor-tier role). 403 / 404 otherwise — same gate the RPC used.
 *   3. With a service-role client (cross-RLS), read the most-recent draft for
 *      (customer_user_id, project_id), then DELETE it so a later engineer on
 *      the next session doesn't re-replay stale prep (the RPC's "consume").
 *
 * Returns: { text: string } when prep exists, else { text: null }. The caller
 * (EngineerSessionClient) posts the opening guest_messages itself — that insert
 * is allowed under existing RLS, so it stays client-side.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { sessionId?: string };

export async function POST(req: NextRequest) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // ── 1. Auth ─────────────────────────────────────────────────────────
  const sbUser = await createClient();
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = userRes.user.id;

  // ── 2. Session + authorization (mirrors engineer_fetch_customer_draft) ─
  const { data: sessionRow, error: sessionErr } = await sbUser
    .from("guest_calls")
    .select("id, project_id, customer_user_id, claimed_by")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }
  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let authorized = sessionRow.claimed_by === userId;
  if (!authorized) {
    const { data: roleRows } = await sbUser
      .from("user_role_names")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    authorized = roles.some(
      (r) => r === "supervisor" || r === "super_admin" || r === "admin",
    );
  }
  if (!authorized) {
    return NextResponse.json(
      { error: "You don't have access to this session." },
      { status: 403 },
    );
  }

  const customerUserId = sessionRow.customer_user_id as string | null;
  const projectId = sessionRow.project_id as string | null;
  // No customer/project tie → nothing to hand off (same as the RPC's NULL).
  if (!customerUserId || !projectId) {
    return NextResponse.json({ text: null });
  }

  // ── 3. Service-role read + consume ──────────────────────────────────
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server is missing Supabase service credentials" },
      { status: 503 },
    );
  }
  const sbService = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: draft, error: draftErr } = await sbService
    .from("customer_session_drafts")
    .select("id, text")
    .eq("customer_user_id", customerUserId)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftErr) {
    return NextResponse.json({ error: draftErr.message }, { status: 500 });
  }

  const text = (draft?.text ?? "").trim();
  if (!draft || !text) {
    return NextResponse.json({ text: null });
  }

  // Consume the staging draft so the next engineer on this project doesn't
  // re-replay it. Best-effort: a failed delete shouldn't block the handoff
  // (worst case the same prep replays once more, which is preferable to
  // losing it).
  //
  // Durability: the prep doesn't need a column — the caller
  // (EngineerSessionClient) posts it as a guest_message right after
  // CUSTOMER_PREP_PRELUDE, and the AI assembler reads it back from there
  // (see lib/relay/engineerAiContext.ts), so it survives reloads + long calls.
  await sbService.from("customer_session_drafts").delete().eq("id", draft.id);

  return NextResponse.json({ text });
}
