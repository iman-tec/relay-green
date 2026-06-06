/*
 * SEAM: pod allocation logic. Threshold = 10 (1st supervisor: 1–10,
 * 2nd: 11–15), prefer same-pod online supervisor, fall back to dynamic
 * when offline.
 *
 *   TODO(allocation): implement threshold + preference rule here later.
 *   UI must not hardcode allocation anywhere else — always call this module.
 *
 * The current rule (as expressed in the database via
 * `supabase/migrations/20260514120000_pods_staff_management.sql`) is
 * "every engineer in pod X belongs to every supervisor in pod X" —
 * `pod_members.UNIQUE(user_id)` puts each user in exactly one pod, and
 * the supervisor view scopes by `pod_id`. There is no engineer →
 * supervisor mapping in the schema today.
 *
 * The next rule (per the brief's §6, coming soon):
 *
 *   - Within a pod, the first 10 engineers (ordered by something stable —
 *     join date, name, employee id — to be decided) belong to the first
 *     supervisor.
 *   - Engineers 11–15 belong to the second supervisor once that second
 *     supervisor is online; up to 15 engineers per pod.
 *   - The mapping is dynamic: when a supervisor goes offline, their
 *     engineers fall back to whichever supervisor IS online.
 *
 * Today's implementation is a pure pass-through:
 *
 *   - `getSupervisorForEngineer` returns the first supervisor in the pod.
 *   - `groupEngineersByPod` returns one bucket per pod.
 *
 * The UI calls into this module so the layout slots ("Assigned supervisor"
 * column, capacity meter, online-state dot) already exist. When the real
 * algorithm lands later, only this file changes — no layout edits.
 */

export interface AllocationEngineer {
  userId: string;
  /** Stable position used by the threshold rule. The pass-through keeps
   *  the caller's input order; the real algorithm will sort by something
   *  durable (join date, employee id, name) and compute the 1-based
   *  index from that. */
  positionInPod: number;
  /** Last-call timestamp — used to derive `online` heuristically until
   *  a real presence channel exists. */
  lastCallAt: string | null;
  /** Optional: caller can hint that the engineer is on a live call right
   *  now (currentCustomer not null), which counts as online regardless
   *  of `lastCallAt`. */
  onLiveCall?: boolean;
}

export interface AllocationSupervisor {
  userId: string;
  displayName: string;
  email: string;
  /** Same heuristic as engineers — `online` is "has recent activity". */
  online: boolean;
  /** Stable order. The threshold rule assigns engineers 1–10 to the
   *  supervisor with `slotIndex === 0`, engineers 11–15 to the
   *  supervisor with `slotIndex === 1`. */
  slotIndex: number;
}

export interface Pod {
  id: string;
  name: string;
}

export interface PodAllocation {
  pod: Pod;
  supervisors: AllocationSupervisor[];
  engineers: AllocationEngineer[];
}

/** First-supervisor / second-supervisor cutover line. */
export const POD_PRIMARY_SUPERVISOR_CAP = 10;
/** Hard cap of engineers per pod (1–10 → sup 0, 11–15 → sup 1). */
export const POD_MAX_ENGINEERS = 15;

/**
 * Derive the assigned supervisor for an engineer within their pod.
 *
 * Today's pass-through impl: return the first supervisor (`slotIndex
 * === 0`) if present, else `null`. The future impl will check
 * `engineer.positionInPod` against `POD_PRIMARY_SUPERVISOR_CAP` and
 * fall back to `engineer.positionInPod <= POD_MAX_ENGINEERS ?
 * supervisors[1] : null`, with online-state preference.
 *
 * @returns the supervisor that owns this engineer right now, or null
 *          if none can be derived (empty pod, etc).
 */
export function getSupervisorForEngineer(
  engineer: AllocationEngineer,
  _pod: Pod,
  supervisors: AllocationSupervisor[]
): AllocationSupervisor | null {
  if (supervisors.length === 0) return null;
  // Pass-through: first supervisor owns everyone.
  // TODO(allocation): replace with the threshold + preference rule.
  void engineer; // intentionally unused in the pass-through
  return supervisors[0] ?? null;
}

/**
 * Group engineers into pods. Today's pass-through keeps the caller's
 * order; the future impl may reorder by `positionInPod`.
 */
export function groupEngineersByPod(
  pods: Pod[],
  engineersByPodId: Record<string, AllocationEngineer[]>,
  supervisorsByPodId: Record<string, AllocationSupervisor[]>
): PodAllocation[] {
  return pods.map((pod) => ({
    pod,
    supervisors: supervisorsByPodId[pod.id] ?? [],
    engineers: engineersByPodId[pod.id] ?? [],
  }));
}

/**
 * Capacity-meter input. The left slot shows the caller's OWN pod engineers
 * against the soft 10-engineer reference; the right slot shows the count of
 * "free" engineers the caller is currently covering for off-duty supervisors
 * (see `distributeFreeEngineers`). The covered slot is uncapped — its number
 * is just however many round-robin allocated to this supervisor.
 */
export function podCapacity(
  ownCount: number,
  coveredCount: number
): {
  total: number; // own + covered (informational header)
  ownCount: number; // left slot — engineers in the caller's own pod
  coveredCount: number; // right slot — free engineers the caller is covering
  primaryCap: number; // soft reference for the left slot (10)
} {
  return {
    total: ownCount + coveredCount,
    ownCount,
    coveredCount,
    primaryCap: POD_PRIMARY_SUPERVISOR_CAP,
  };
}

/* ── Cross-pod coverage: free-engineer round-robin ─────────────────────────
 *
 * When a supervisor is OFF DUTY their whole pod is left uncovered, so every
 * engineer in that pod becomes a "free engineer". Free engineers are dealt
 * round-robin across the ON-DUTY supervisors (sup1, sup2, sup1, …) so an odd
 * remainder lands on the earlier supervisor. There is no per-supervisor cap —
 * everyone free is allocated as long as at least one supervisor is on duty.
 *
 * Pure + deterministic (no randomness, stable sorts) so the 5 s roster poll
 * never reshuffles who covers whom between refreshes.
 */

export interface CoverageSupervisor {
  userId: string;
  podId: string;
  online: boolean;
  /** Stable, human-meaningful order key (sup1 < sup2 < sup3). */
  displayName: string;
}

export interface CoverageEngineer {
  userId: string;
  podId: string;
}

export interface FreeEngineerAllocation {
  /** on-duty supervisor userId → the free engineer userIds they cover. */
  assignment: Map<string, string[]>;
  /** free engineers nobody can cover — only non-empty when zero supervisors
   *  are on duty. Surfaced so the UI never silently drops them. */
  uncovered: string[];
}

export function distributeFreeEngineers(input: {
  supervisors: CoverageSupervisor[];
  engineers: CoverageEngineer[];
}): FreeEngineerAllocation {
  // 1. On-duty supervisors, stable order (remainder lands on the earlier one).
  const onDuty = input.supervisors
    .filter((s) => s.online)
    .sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) ||
        a.userId.localeCompare(b.userId)
    );

  const assignment = new Map<string, string[]>();
  for (const s of onDuty) assignment.set(s.userId, []);

  // 2. A pod is "covered" if it has at least one on-duty supervisor.
  const coveredPodIds = new Set(onDuty.map((s) => s.podId));

  // 3. Free engineers = those whose pod has no on-duty supervisor, stable order.
  const free = input.engineers
    .filter((e) => !coveredPodIds.has(e.podId))
    .sort(
      (a, b) =>
        a.podId.localeCompare(b.podId) || a.userId.localeCompare(b.userId)
    );

  // 4. Nobody on duty → nobody can cover; report every free engineer.
  if (onDuty.length === 0) {
    return { assignment, uncovered: free.map((e) => e.userId) };
  }

  // 5. Deal round-robin across the on-duty supervisors.
  free.forEach((eng, i) => {
    const sup = onDuty[i % onDuty.length];
    assignment.get(sup.userId)!.push(eng.userId);
  });

  return { assignment, uncovered: [] };
}

/**
 * Online-state heuristic. Until a real presence channel exists, we
 * treat any engineer / supervisor with a last-call timestamp in the
 * last 5 minutes as "online", plus anyone currently on a live call.
 *
 * TODO(api): swap to a real presence channel (Supabase realtime
 * "broadcast" or `user_presence` table). Keep the boolean return
 * shape stable — call-sites won't change.
 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function isOnlineFromLastSeen(
  lastSeen: string | null,
  options?: { onLiveCall?: boolean; now?: number }
): boolean {
  if (options?.onLiveCall) return true;
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  if (!Number.isFinite(t)) return false;
  return (options?.now ?? Date.now()) - t <= ONLINE_WINDOW_MS;
}
