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
import {
  getSupervisorForEngineer,
  isOnlineFromLastSeen,
  podCapacity,
  POD_MAX_ENGINEERS,
  POD_PRIMARY_SUPERVISOR_CAP,
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

type TeamResponse = {
  pod?: Pod | null;
  engineers?: Engineer[];
  /** TODO(api): backend can populate this; UI ignores when missing. */
  supervisors?: AllocationSupervisor[];
};

export function OperationsClient() {
  const [pod, setPod] = useState<Pod | null>(null);
  const [rows, setRows] = useState<Engineer[]>([]);
  const [supervisors, setSupervisors] = useState<AllocationSupervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  // Supervisor flips an engineer online/offline (engineer_profiles.is_available
  // via the supervisor_set_engineer_online RPC). Optimistic update; revert on
  // error. The 5s poll reconciles either way.
  const setEngineerOnline = useCallback(
    async (engineerId: string, makeOnline: boolean) => {
      setPendingId(engineerId);
      setRows((prev) =>
        prev.map((r) =>
          r.userId === engineerId ? { ...r, isOnline: makeOnline } : r
        )
      );
      const { error } = await supabaseRef.current.rpc(
        "supervisor_set_engineer_online",
        {
          _engineer_id: engineerId,
          _online: makeOnline,
        }
      );
      if (error) {
        setRows((prev) =>
          prev.map((r) =>
            r.userId === engineerId ? { ...r, isOnline: !makeOnline } : r
          )
        );
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.currentCustomer ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Build the AllocationEngineer view-model for each row. positionInPod
  // is 1-based and reflects the caller's row order (the threshold rule
  // will replace this with a durable sort later).
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

  const capacity = podCapacity(allocRows);

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      <SectionHeader
        title={pod ? `Pod ${pod.name}` : "Operations"}
        // Wrapped so the description is hidden on phones (the empty <p>
        // collapses); shown on sm+.
        subtitle={
          <span className="hidden sm:inline">
            Engineers under your watch. The capacity meter shows the 10-engineer
            threshold — engineers 1–10 belong to the first supervisor, 11–15 to
            the second.
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

      {pod && allocRows.length > 0 && (
        <CapacityMeter capacity={capacity} supervisors={supervisors} />
      )}

      <Card variant="surface">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2
              size={16}
              className="animate-spin text-[var(--text-muted)]"
            />
          </div>
        ) : filtered.length === 0 ? (
          <UiEmptyState
            compact
            icon={<Users size={20} className="text-[var(--text-muted)]" />}
            title={
              rows.length === 0 ? "No engineers in your pod yet" : "No matches"
            }
            body={
              rows.length === 0
                ? "Once an engineer joins your pod they'll appear here."
                : `No engineers match "${query}".`
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
                {filtered.map((r) => {
                  const alloc = allocRows.find((a) => a.userId === r.userId);
                  const supervisor =
                    alloc && pod
                      ? getSupervisorForEngineer(alloc, pod, supervisors)
                      : null;
                  // Prefer the explicit online toggle (§3.2); fall back to
                  // the last-seen heuristic for engineers without a profile.
                  const engineerOnline =
                    !!r.currentCustomer ||
                    (r.isOnline ??
                      isOnlineFromLastSeen(r.lastCallAt, {
                        onLiveCall: !!r.currentCustomer,
                      }));
                  return (
                    <tr
                      key={r.userId}
                      className="border-t border-[var(--border)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_3%,transparent)]"
                    >
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
                        {supervisor ? (
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className={cn(
                                "inline-block size-1.5 rounded-full",
                                supervisor.online
                                  ? "bg-[var(--ok)]"
                                  : "bg-[var(--text-faint)]"
                              )}
                              title={supervisor.online ? "Online" : "Offline"}
                            />
                            <div className="min-w-0">
                              <div className="text-sm text-[var(--text)]">
                                {supervisor.displayName}
                              </div>
                              <div className="truncate text-xs text-[var(--text-muted)]">
                                {supervisor.online ? "Online" : "Offline"}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span
                            className="text-xs text-[var(--text-faint)]"
                            title="Allocation pending — waiting for backend to expose supervisors[]"
                          >
                            —
                          </span>
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
                              {new Date(r.lastCallAt).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </Td>
                      <Td>
                        {(() => {
                          const isAvail = r.isOnline ?? false;
                          return (
                            <button
                              type="button"
                              disabled={pendingId === r.userId}
                              onClick={() =>
                                void setEngineerOnline(r.userId, !isAvail)
                              }
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
                                  isAvail
                                    ? "bg-[var(--ok)]"
                                    : "bg-[var(--text-faint)]"
                                )}
                              />
                              {isAvail ? "Online" : "Offline"}
                            </button>
                          );
                        })()}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Capacity meter (1–10 / 11–15 threshold visualisation) ───────── */

function CapacityMeter({
  capacity,
  supervisors,
}: {
  capacity: ReturnType<typeof podCapacity>;
  supervisors: AllocationSupervisor[];
}) {
  const sup1 = supervisors[0] ?? null;
  const sup2 = supervisors[1] ?? null;

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
          <div className="flex items-center gap-3 text-xs">
            <span className="text-[var(--text-muted)] tabular-nums">
              {capacity.total} / {POD_MAX_ENGINEERS}
            </span>
            {capacity.overflow > 0 && (
              <StatusBadge tone="risk" compact>
                {capacity.overflow} over
              </StatusBadge>
            )}
          </div>
        </div>

        <div
          className="grid h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
          style={{
            gridTemplateColumns: `${POD_PRIMARY_SUPERVISOR_CAP}fr ${POD_MAX_ENGINEERS - POD_PRIMARY_SUPERVISOR_CAP}fr`,
          }}
        >
          <div className="relative">
            <div
              className="h-full bg-[var(--primary)] transition-[width] duration-[var(--motion-med)]"
              style={{
                width: `${(capacity.primary / POD_PRIMARY_SUPERVISOR_CAP) * 100}%`,
              }}
            />
          </div>
          <div className="relative border-l-2 border-[var(--background)]">
            <div
              className="h-full bg-[var(--green-dot)] transition-[width] duration-[var(--motion-med)]"
              style={{
                width: `${
                  (capacity.secondary /
                    (POD_MAX_ENGINEERS - POD_PRIMARY_SUPERVISOR_CAP)) *
                  100
                }%`,
              }}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
          <SupervisorSlot
            label="Engineers 1–10"
            supervisor={sup1}
            count={capacity.primary}
            cap={POD_PRIMARY_SUPERVISOR_CAP}
            accent="primary"
          />
          <SupervisorSlot
            label="Engineers 11–15"
            supervisor={sup2}
            count={capacity.secondary}
            cap={POD_MAX_ENGINEERS - POD_PRIMARY_SUPERVISOR_CAP}
            accent="green"
          />
        </div>

        <p className="mt-3 hidden text-[11px] leading-relaxed text-[var(--text-faint)] sm:block">
          {/* SEAM hint surfaced inline so admins know why allocation looks
              flat today (pass-through impl). Hidden on phones. */}
          Allocation rule (preview): the first 10 engineers belong to the
          first supervisor; engineers 11–15 belong to the second once
          they&apos;re online. Cleanup in progress — see
          <code className="mx-1 rounded bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1 py-0.5 font-mono text-[10px]">
            lib/allocation/podAllocation.ts
          </code>
          for the seam.
        </p>
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
}: {
  label: string;
  supervisor: AllocationSupervisor | null;
  count: number;
  cap: number;
  accent: "primary" | "green";
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
          {count} / {cap}
        </span>
      </div>
      <div className="mt-1 truncate text-[var(--text-muted)]">
        {supervisor
          ? `${supervisor.online ? "● Online · " : "○ Offline · "}${supervisor.displayName}`
          : "Slot open"}
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
