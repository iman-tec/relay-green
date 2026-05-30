/*
 * POST /api/match/presence  { engineerIds: string[] }
 *   → { presence: { [engineerId]: "available" | "busy" | "offline" } }
 *
 * Real-time-ish presence for the customer's "Pick your engineer" modal. The
 * picker used to fake availability ("most recent = available, next = busy,
 * rest = offline"), which is why engineers who were plainly online showed as
 * Busy/Offline. A customer can't read engineer_presence / engineer_profiles /
 * other engineers' active calls directly (RLS), so this service-role endpoint
 * resolves it for the specific engineers the picker is showing.
 *
 * The rule matches the matcher's own eligibility (broadcast-match /
 * match_engineer):
 *   online    = heartbeat-fresh (<90s) OR engineer_profiles.is_available
 *   busy      = online AND currently claimed on an active call
 *   available = online AND not busy
 *   offline   = not online
 *
 * The client polls this every ~12s while the modal is open (heartbeats land
 * every ~10s with a 90s freshness window, so a 12s poll tracks reality
 * closely without a realtime subscription that RLS would block).
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const HEARTBEAT_FRESH_MS = 90_000;
const ACTIVE_CALL_STATUSES = ["assigned", "joining", "live", "grace", "expired_free", "ending"];

type Status = "available" | "busy" | "offline";

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { engineerIds?: unknown };
  const ids = Array.isArray(body.engineerIds)
    ? (body.engineerIds.filter((x) => typeof x === "string") as string[])
    : [];
  if (ids.length === 0) return NextResponse.json({ presence: {} });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [presRes, profRes, busyRes] = await Promise.all([
    admin.from("engineer_presence").select("engineer_id, last_seen_at").in("engineer_id", ids),
    admin.from("engineer_profiles").select("user_id, is_available").in("user_id", ids),
    admin.from("guest_calls").select("claimed_by, status").in("claimed_by", ids).in("status", ACTIVE_CALL_STATUSES),
  ]);

  const now = Date.now();
  const freshById = new Map<string, boolean>();
  for (const p of (presRes.data ?? []) as { engineer_id: string; last_seen_at: string | null }[]) {
    freshById.set(p.engineer_id, !!p.last_seen_at && now - new Date(p.last_seen_at).getTime() < HEARTBEAT_FRESH_MS);
  }
  const availableById = new Map<string, boolean>();
  for (const p of (profRes.data ?? []) as { user_id: string; is_available: boolean | null }[]) {
    availableById.set(p.user_id, !!p.is_available);
  }
  const busyIds = new Set(
    ((busyRes.data ?? []) as { claimed_by: string | null }[])
      .map((r) => r.claimed_by)
      .filter((id): id is string => !!id),
  );

  const presence: Record<string, Status> = {};
  for (const id of ids) {
    const online = freshById.get(id) || availableById.get(id);
    presence[id] = !online ? "offline" : busyIds.has(id) ? "busy" : "available";
  }

  return NextResponse.json({ presence });
}
