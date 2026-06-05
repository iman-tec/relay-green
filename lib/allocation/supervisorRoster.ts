/*
 * Server helper: resolve the engineers a supervisor is responsible for right
 * now — the engineers in their OWN pod, plus the "foster" engineers they're
 * covering for off-duty supervisors (the round-robin coverage rule).
 *
 * The actual allocation is the pure `distributeFreeEngineers` in
 * ./podAllocation, so any caller of this helper stays consistent with the
 * Operations roster (/api/supervisor/team) — same inputs → same foster set.
 *
 * Takes a service-role `admin` client; the CALLER is responsible for authn/z.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { distributeFreeEngineers } from "./podAllocation";

export interface SupervisorRoster {
  /** The pod this user supervises, or null if they supervise none. */
  podId: string | null;
  /** Engineer userIds in the supervisor's own pod. */
  ownEngineerIds: string[];
  /** Engineer userIds fostered from off-duty supervisors' pods. */
  fosterEngineerIds: string[];
  /** Whether this supervisor is currently on duty (supervisor_presence). */
  callerOnDuty: boolean;
}

export async function getSupervisorRoster(
  admin: SupabaseClient,
  supervisorUserId: string
): Promise<SupervisorRoster> {
  // The pod this user is the supervisor of.
  const { data: myMembership } = await admin
    .from("pod_members")
    .select("pod_id")
    .eq("user_id", supervisorUserId)
    .eq("pod_role", "supervisor")
    .maybeSingle();
  const podId = (myMembership as { pod_id?: string } | null)?.pod_id ?? null;

  // Global pod map + on-duty state, so we can run the same distribution the
  // Operations roster does.
  const [{ data: allMembers }, { data: presenceRows }] = await Promise.all([
    admin
      .from("pod_members")
      .select("user_id, pod_id, pod_role")
      .in("pod_role", ["supervisor", "engineer"]),
    admin.from("supervisor_presence").select("user_id, is_online"),
  ]);

  const onlineByUser = new Map<string, boolean>();
  for (const r of (presenceRows ?? []) as {
    user_id: string;
    is_online: boolean;
  }[]) {
    onlineByUser.set(r.user_id, r.is_online);
  }

  const memberRows = (allMembers ?? []) as {
    user_id: string;
    pod_id: string;
    pod_role: string;
  }[];
  const supMemberRows = memberRows.filter((m) => m.pod_role === "supervisor");
  const engMemberRows = memberRows.filter((m) => m.pod_role === "engineer");

  // Supervisor display names — the stable round-robin order key.
  const supIds = supMemberRows.map((m) => m.user_id);
  const supNameById = new Map<string, string>();
  if (supIds.length) {
    const { data: supProfiles } = await admin
      .from("profiles_with_role")
      .select("id, full_name")
      .in("id", supIds);
    for (const p of (supProfiles ?? []) as {
      id: string;
      full_name: string | null;
    }[]) {
      supNameById.set(p.id, p.full_name ?? "Unnamed");
    }
  }

  const { assignment } = distributeFreeEngineers({
    supervisors: supMemberRows.map((m) => ({
      userId: m.user_id,
      podId: m.pod_id,
      online: onlineByUser.get(m.user_id) ?? false,
      displayName: supNameById.get(m.user_id) ?? "Unnamed",
    })),
    engineers: engMemberRows.map((m) => ({
      userId: m.user_id,
      podId: m.pod_id,
    })),
  });

  const ownEngineerIds = podId
    ? engMemberRows.filter((m) => m.pod_id === podId).map((m) => m.user_id)
    : [];
  const fosterEngineerIds = assignment.get(supervisorUserId) ?? [];
  const callerOnDuty = onlineByUser.get(supervisorUserId) ?? false;

  return { podId, ownEngineerIds, fosterEngineerIds, callerOnDuty };
}
