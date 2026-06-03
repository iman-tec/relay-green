/*
 * Supervisor inbox feed — all-platform sessions.
 *
 * GET /api/supervisor/inbox
 *   Returns the most recent guest_calls across the whole platform (any
 *   status), newest first, so the supervisor's inbox can build the same
 *   three-column view the engineer sees (People · per-customer history ·
 *   call log) but scoped to EVERY customer, not just their own.
 *
 * Gated to supervisor / super_admin. Uses the service role so the feed
 * isn't narrowed by per-pod RLS on guest_calls — the product decision is
 * an all-platform lens for supervisors.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap the feed so a large history doesn't ship megabytes to the client.
// The inbox call log defaults to showing the latest 30 with a "show all"
// toggle + date-range filters, so 400 gives plenty of depth to dig into.
const SESSION_CAP = 400;

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes(ROLE.supervisor) && !roles.includes(ROLE.super_admin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from("guest_calls")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(SESSION_CAP);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessions: data ?? [] });
}
