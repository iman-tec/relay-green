"use client";

/*
 * Supervisor operations roster — table of every engineer in the caller's
 * pod. Columns: name + email, assigned supervisor (via the pod-allocation
 * SEAM), currently working with, last call.
 *
 * Phase-9 restyle: visual + adds the §6 SEAM slots (assigned supervisor
 * column, online dot, capacity meter). Logic comes from
 * `lib/allocation/podAllocation.ts` — today's pass-through returns the
 * first supervisor for every engineer, so the UI mirrors current
 * behaviour while leaving room for the 10/15-threshold rule later.
 *
 * Data contracts untouched: same GET /api/supervisor/team, same Engineer
 * shape. The "assigned supervisor" column derives from
 * `body.supervisors` if the API surfaces it; otherwise it falls back to
 * displaying nothing — the seam still exists in code, the UI just has
 * no data to render until backend wires the list up.
 *   TODO(api): /api/supervisor/team should return `supervisors[]` in
 *   addition to `engineers[]` (and a `myUserId` so we know which one is
 *   the viewer). UI shape below already accepts that.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Users } from "lucide-react";
import {
  Avatar,
  Card,
  EmptyState as UiEmptyState,
  Input,
  SectionHeader,
  StatusBadge,
  cn,
} from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import { Segmented } from "@/app/_components/admin-v2/Segmented";
import {
  getSupervisorForEngineer,
  isOnlineFromLastSeen,
  podCapacity,
  type AllocationEngineer,
  type AllocationSupervisor,
  type Pod,
} from "@/lib/allocation/podAllocation";

type Engineer = {
  userId: string;
  displayName: string;
  email: string;
  primaryRole: string;
  currentCustomer: string | null;
  lastCustomer: string | null;
  lastCallAt: string | null;
  /** Explicit online/offline toggle (engineer_profiles.is_available). null
   *  for engineers without a profile row — fall back to the last-seen heuristic. */
  isOnline: boolean | null;
};

/** An engineer the caller is covering for an off-duty supervisor (cross-pod). */
type CoveredEngineer = Engineer & {
  coveredFromPodId: string | null;
  coveredFromPodName: string | null;
  coveredFromSupervisorName: string | null;
};

type Coverage = {
  coveredCount: number;
  uncovered: number; // free engineers nobody can cover (only when 0 on-duty)
  callerOnDuty: boolean;
};

type TeamResponse = {
  pod?: Pod | null;
  engineers?: Engineer[];
  /** Free engineers from off-duty pods, round-robin allocated to this caller. */
  coveredEngineers?: CoveredEngineer[];
  supervisors?: AllocationSupervisor[];
  coverage?: Coverage | null;
};

export function OperationsClient() {
  const [pod, setPod] = useState<Pod | null>(null);
  const [rows, setRows] = useState<Engineer[]>([]);
  const [coveredRows, setCoveredRows] = useState<CoveredEngineer[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [supervisors, setSupervisors] = useState<AllocationSupervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // Which roster the table shows: the caller's own pod, or the engineers they
  // are fostering (covering) for off-duty supervisors.
  const [tab, setTab] = useState<"pod" | "foster">("pod");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  // Supervisor flips an engineer online/offline (engineer_profiles.is_available
  // via the supervisor_set_engineer_online RPC). Optimistic update; revert on
  // error. The 5s poll reconciles either way.
  const setEngineerOnline = useCallback(
    async (engineerId: string, makeOnline: boolean) => {
      setPendingId(engineerId);
      // Optimistic on both lists — covered engineers get full control too.
      const flip = (online: boolean) => {
        const apply = <T extends Engineer>(prev: T[]): T[] =>
          prev.map((r) =>
            r.userId === engineerId ? { ...r, isOnline: online } : r
          );
        setRows(apply);
        setCoveredRows(apply);
      };
      flip(makeOnline);
      const { error } = await supabaseRef.current.rpc(
        "supervisor_set_engineer_online",
        {
          _engineer_id: engineerId,
          _online: makeOnline,
        }
      );
      if (error) {
        flip(!makeOnline); // revert
        console.warn("[operations] set engineer online failed:", error.message);
      }
      setPendingId(null);
    },
    []
  );

  // Fetch on mount + poll every 5s so the roster's online dots stay live
  // as engineers toggle availability (§3.2).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/supervisor/team", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as TeamResponse;
      if (!alive) return;
      setPod((body.pod ?? null) as Pod | null);
      setRows((body.engineers ?? []) as Engineer[]);
      setCoveredRows((body.coveredEngineers ?? []) as CoveredEngineer[]);
      setCoverage((body.coverage ?? null) as Coverage | null);
      setSupervisors((body.supervisors ?? []) as AllocationSupervisor[]);
      setLoading(false);
    };
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const matchesQuery = useCallback(
    (r: Engineer) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.currentCustomer ?? "").toLowerCase().includes(q)
      );
    },
    [query]
  );

  const filtered = useMemo(
    () => rows.filter(matchesQuery),
    [rows, matchesQuery]
  );
  const filteredCovered = useMemo(
    () => coveredRows.filter(matchesQuery),
    [coveredRows, matchesQuery]
  );

  // The roster the active tab renders (and its unfiltered total, for the
  // empty-state copy: "no matches" vs "nothing here yet").
  const activeRows = tab === "pod" ? filtered : filteredCovered;
  const activeTotal = tab === "pod" ? rows.length : coveredRows.length;

  // Build the AllocationEngineer view-model for each OWN row, used to derive
  // the assigned supervisor (pass-through → the pod's own supervisor).
  const allocRows = useMemo<AllocationEngineer[]>(
    () =>
      rows.map((r, i) => ({
        userId: r.userId,
        positionInPod: i + 1,
        lastCallAt: r.lastCallAt,
        onLiveCall: !!r.currentCustomer,
      })),
    [rows]
  );

  // Left slot = own pod count; right slot = free engineers covered (uncapped).
  const capacity = podCapacity(rows.length, coveredRows.length);

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      <SectionHeader
        title={pod ? `Pod ${pod.name}` : "Operations"}
        // Wrapped so the description is hidden on phones (the empty <p>
        // collapses); shown on sm+.
        subtitle={
          <span className="hidden sm:inline">
            Engineers under your watch. While you&apos;re on duty, engineers from
            off-duty supervisors&apos; pods are shared out to you here.
          </span>
        }
        right={
          <div className="w-72 max-w-full">
            <Input
              srLabel="Search engineers"
              prefix={<Search size={14} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search engineers…"
              size="md"
            />
          </div>
        }
      />

      {pod && (rows.length > 0 || coveredRows.length > 0) && (
        <CapacityMeter capacity={capacity} supervisors={supervisors} />
      )}

      {coverage && coverage.uncovered > 0 && (
        <p className="text-xs text-[var(--risk)]">
          {coverage.uncovered} free engineer
          {coverage.uncovered === 1 ? "" : "s"} have no supervisor on duty — go
          on duty to cover them.
        </p>
      )}

      <Card variant="surface">
        <div className="pb-3">
          <Segmented
            value={tab}
            onChange={setTab}
            ariaLabel="Roster view"
            options={[
              { key: "pod", label: `Pod Engineers · ${rows.length}` },
              { key: "foster", label: `Foster Engineers · ${coveredRows.length}` },
            ]}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2
              size={16}
              className="animate-spin text-[var(--text-muted)]"
            />
          </div>
        ) : activeRows.length === 0 ? (
          <UiEmptyState
            compact
            icon={<Users size={20} className="text-[var(--text-muted)]" />}
            title={
              activeTotal > 0
                ? "No matches"
                : tab === "pod"
                  ? "No engineers in your pod yet"
                  : "No engineers to foster"
            }
            body={
              activeTotal > 0
                ? `No engineers match "${query}".`
                : tab === "pod"
                  ? "Once an engineer joins your pod they'll appear here."
                  : "While you're on duty, engineers from off-duty supervisors' pods show up here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            {/* min-w keeps columns from squeezing on phones (headers wrapping
                one letter per line); the wrapper scrolls horizontally instead. */}
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-[var(--surface-raised)]">
                <tr className="border-b border-[var(--border)]">
                  <Th>Engineer</Th>
                  <Th>Assigned supervisor</Th>
                  <Th>Status</Th>
                  <Th>Last call</Th>
                  <Th>Availability</Th>
                </tr>
              </thead>
              <tbody>
                {tab === "pod"
                  ? filtered.map((r) => {
                      const alloc = allocRows.find(
                        (a) => a.userId === r.userId
                      );
                      const supervisor =
                        alloc && pod
                          ? getSupervisorForEngineer(alloc, pod, supervisors)
                          : null;
                      return (
                        <EngineerRow
                          key={r.userId}
                          r={r}
                          assigned={
                            supervisor
                              ? {
                                  displayName: supervisor.displayName,
                                  online: supervisor.online,
                                  covering: false,
                                }
                              : null
                          }
                          pendingId={pendingId}
                          onToggle={setEngineerOnline}
                        />
                      );
                    })
                  : filteredCovered.map((r) => (
                      <EngineerRow
                        key={r.userId}
                        r={r}
                        assigned={{
                          displayName: r.coveredFromSupervisorName ?? "—",
                          online: false,
                          covering: true,
                          podName: r.coveredFromPodName,
                        }}
                        pendingId={pendingId}
                        onToggle={setEngineerOnline}
                      />
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Roster row (shared by own-pod + covered engineers) ──────────── */

function EngineerRow({
  r,
  assigned,
  pendingId,
  onToggle,
}: {
  r: Engineer;
  assigned: {
    displayName: string;
    online: boolean;
    covering: boolean;
    podName?: string | null;
  } | null;
  pendingId: string | null;
  onToggle: (engineerId: string, makeOnline: boolean) => void;
}) {
  // Prefer the explicit online toggle (§3.2); fall back to the last-seen
  // heuristic for engineers without a profile.
  const engineerOnline =
    !!r.currentCustomer ||
    (r.isOnline ??
      isOnlineFromLastSeen(r.lastCallAt, {
        onLiveCall: !!r.currentCustomer,
      }));
  const isAvail = r.isOnline ?? false;

  return (
    <tr className="border-t border-[var(--border)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_3%,transparent)]">
      <Td>
        <div className="flex items-center gap-3">
          <Avatar
            name={r.displayName}
            email={r.email}
            size="sm"
            tone={engineerOnline ? "ok" : "neutral"}
          />
          <div className="min-w-0">
            <div className="font-medium text-[var(--text)]">
              {r.displayName}
            </div>
            <div className="truncate text-xs text-[var(--text-muted)]">
              {r.email || "—"}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        {assigned ? (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-block size-1.5 rounded-full",
                assigned.online ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]"
              )}
              title={assigned.online ? "Online" : "Offline"}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-[var(--text)]">
                  {assigned.displayName}
                </span>
                {assigned.covering && (
                  <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] font-medium text-[var(--text-muted)]">
                    Covering
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-[var(--text-muted)]">
                {assigned.covering
                  ? `Off duty${assigned.podName ? ` · ${assigned.podName}` : ""}`
                  : assigned.online
                    ? "Online"
                    : "Offline"}
              </div>
            </div>
          </div>
        ) : (
          <span className="text-xs text-[var(--text-faint)]">—</span>
        )}
      </Td>
      <Td>
        {r.currentCustomer ? (
          <span className="inline-flex items-center gap-2">
            <StatusBadge tone="ok" compact pulse>
              On call
            </StatusBadge>
            <span className="text-xs text-[var(--text)]">
              with {r.currentCustomer}
            </span>
          </span>
        ) : (
          <StatusBadge tone="neutral" compact>
            Idle
          </StatusBadge>
        )}
      </Td>
      <Td>
        {r.lastCallAt ? (
          <span className="text-[var(--text)]">
            {r.lastCustomer ?? "—"}
            <span className="ml-2 text-[12px] text-[var(--text-muted)]">
              {new Date(r.lastCallAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </Td>
      <Td>
        <button
          type="button"
          disabled={pendingId === r.userId}
          onClick={() => void onToggle(r.userId, !isAvail)}
          title={
            isAvail
              ? "Set this engineer offline"
              : "Set this engineer online"
          }
          aria-pressed={isAvail}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            isAvail
              ? "border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[var(--ok-soft)] text-[var(--ok)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-1.5 rounded-full",
              isAvail ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]"
            )}
          />
          {isAvail ? "Online" : "Offline"}
        </button>
      </Td>
    </tr>
  );
}

/* ── Capacity meter: own pod (left) + free engineers covered (right) ── */

function CapacityMeter({
  capacity,
  supervisors,
}: {
  capacity: ReturnType<typeof podCapacity>;
  supervisors: AllocationSupervisor[];
}) {
  const sup1 = supervisors[0] ?? null;
  const ownPct =
    capacity.primaryCap > 0
      ? Math.min(100, (capacity.ownCount / capacity.primaryCap) * 100)
      : 0;

  return (
    <Card variant="raised">
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text)]">
              Pod capacity
            </h3>
          </div>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {capacity.ownCount} / {capacity.primaryCap}
            {capacity.coveredCount > 0 &&
              ` + ${capacity.coveredCount} covering`}
          </span>
        </div>

        {/* Own-pod fill — a container filled to ownCount / 10 (e.g. 4/10 = 40%). */}
        <div className="h-2.5 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-raised)]">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-[var(--motion-med)]"
            style={{ width: `${ownPct}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
          <SupervisorSlot
            label="Pod Engineers"
            supervisor={sup1}
            count={capacity.ownCount}
            cap={capacity.primaryCap}
            accent="primary"
          />
          <SupervisorSlot
            label="Engineers"
            supervisor={null}
            count={capacity.coveredCount}
            cap={null}
            accent="green"
            subtitle={
              capacity.coveredCount > 0
                ? `Covering ${capacity.coveredCount}`
                : "Slot open"
            }
          />
        </div>
      </div>
    </Card>
  );
}

function SupervisorSlot({
  label,
  supervisor,
  count,
  cap,
  accent,
  subtitle,
}: {
  label: string;
  supervisor: AllocationSupervisor | null;
  /** null → show just the count (uncapped slot). */
  cap: number | null;
  count: number;
  accent: "primary" | "green";
  subtitle?: string;
}) {
  const dot = accent === "primary" ? "var(--primary)" : "var(--green-dot)";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text)]">
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full"
            style={{ background: dot }}
          />
          {label}
        </span>
        <span className="text-[var(--text-muted)] tabular-nums">
          {cap === null ? count : `${count} / ${cap}`}
        </span>
      </div>
      <div className="mt-1 truncate text-[var(--text-muted)]">
        {subtitle ??
          (supervisor
            ? `${supervisor.online ? "● Online · " : "○ Offline · "}${supervisor.displayName}`
            : "Slot open")}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-[var(--text-muted)] uppercase">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="h-14 px-5 py-2.5 align-middle whitespace-nowrap text-[var(--text)]">
      {children}
    </td>
  );
}
