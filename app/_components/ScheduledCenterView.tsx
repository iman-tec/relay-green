"use client";

/*
 * Scheduled center-pane view — a "call logs" layout: a "Scheduled appointments"
 * section (supervisor appointments) followed by a "Scheduled calls" section
 * (customer↔engineer booked calls). Each section hides when it has no rows; if
 * nothing is scheduled at all, an empty state shows. Display-focused, with a
 * start-call action on an appointment once its slot time arrives.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Phone,
  Loader2,
  Search,
  RefreshCw,
  X,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ScheduleEngineerModal } from "./ScheduleEngineerModal";

// Quick-pick reasons that pre-fill the cancel note (the box stays editable).
const CANCEL_REASONS = [
  "Something came up",
  "No longer needed",
  "Wrong time — will rebook",
  "Issue already resolved",
];

type Appt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  projectName: string | null;
  callStartedAt: string | null;
};

type Call = {
  id: string;
  slotStart: string;
  projectName: string;
  engineerName: string;
  engineerUserId: string;
  projectId: string | null;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function ScheduledCenterView({
  customerUserId,
}: {
  customerUserId: string | null;
}) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Scheduled-call (engineer) row actions: which row is expanded, its cancel
  // reason, busy flag, and the call being rescheduled (opens the scheduler).
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const [cancelCallFor, setCancelCallFor] = useState<string | null>(null);
  const [cancelCallReason, setCancelCallReason] = useState("");
  const [callBusy, setCallBusy] = useState(false);
  const [rescheduleCall, setRescheduleCall] = useState<Call | null>(null);

  const term = query.trim().toLowerCase();
  const shownAppts = useMemo(
    () =>
      term
        ? appts.filter((a) =>
            (a.projectName ?? "").toLowerCase().includes(term)
          )
        : appts,
    [appts, term]
  );
  const shownCalls = useMemo(
    () =>
      term
        ? calls.filter(
            (c) =>
              c.projectName.toLowerCase().includes(term) ||
              c.engineerName.toLowerCase().includes(term)
          )
        : calls,
    [calls, term]
  );

  // PERF: only run the per-second clock while an appointment is still pending
  // (so its "Call" button can flip at slot time) — otherwise skip the churn.
  const hasPendingAppt = appts.some((a) => !a.callStartedAt);
  useEffect(() => {
    if (!hasPendingAppt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasPendingAppt]);

  // Real-time: reload when the customer's appointments or scheduled calls
  // change anywhere (booked / cancelled / started).
  useEffect(() => {
    if (!customerUserId) return;
    const sb = createClient();
    const ch = sb
      .channel(`scheduled-center-${customerUserId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "supervisor_bookings",
          filter: `customer_user_id=eq.${customerUserId}`,
        },
        () => setTick((t) => t + 1)
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engineer_bookings",
          filter: `customer_user_id=eq.${customerUserId}`,
        },
        () => setTick((t) => t + 1)
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [customerUserId]);

  // In-app booking changes (created / cancelled / rescheduled) refresh
  // instantly via a window event — independent of DB realtime.
  useEffect(() => {
    const onChanged = () => setTick((t) => t + 1);
    window.addEventListener("relay:scheduled-changed", onChanged);
    window.addEventListener("relay:appointments-changed", onChanged);
    return () => {
      window.removeEventListener("relay:scheduled-changed", onChanged);
      window.removeEventListener("relay:appointments-changed", onChanged);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!customerUserId) {
        setLoading(false);
        return;
      }
      const sb = createClient();
      const nowIso = new Date().toISOString();
      const fromIso = new Date(Date.now() - 10 * 60_000).toISOString();
      const [apptRes, callRes] = await Promise.all([
        sb
          .from("supervisor_bookings")
          .select("id, slot_start, slot_end, project_name, call_started_at")
          .eq("customer_user_id", customerUserId)
          .eq("status", "booked")
          .gte("slot_end", nowIso)
          .order("slot_start", { ascending: true }),
        sb
          .from("engineer_bookings")
          .select("id, engineer_user_id, project_id, slot_start, slot_end")
          .eq("customer_user_id", customerUserId)
          .eq("status", "booked")
          .gte("slot_end", fromIso)
          .order("slot_start", { ascending: true }),
      ]);
      if (!alive) return;
      setAppts(
        (
          (apptRes.data ?? []) as Array<{
            id: string;
            slot_start: string;
            slot_end: string;
            project_name: string | null;
            call_started_at: string | null;
          }>
        ).map((r) => ({
          id: r.id,
          slotStart: r.slot_start,
          slotEnd: r.slot_end,
          projectName: r.project_name,
          callStartedAt: r.call_started_at,
        }))
      );

      const callRows = (callRes.data ?? []) as Array<{
        id: string;
        engineer_user_id: string;
        project_id: string | null;
        slot_start: string;
        slot_end: string;
      }>;
      const engIds = [...new Set(callRows.map((r) => r.engineer_user_id))];
      const projIds = [
        ...new Set(
          callRows.map((r) => r.project_id).filter((x): x is string => !!x)
        ),
      ];
      const [engRes, projRes] = await Promise.all([
        engIds.length
          ? sb
              .from("engineer_profiles")
              .select("user_id, display_alias")
              .in("user_id", engIds)
          : Promise.resolve({ data: [] }),
        projIds.length
          ? sb.from("projects").select("id, name").in("id", projIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (!alive) return;
      const aliasById = new Map<string, string>();
      for (const e of (engRes.data ?? []) as Array<{
        user_id: string;
        display_alias: string | null;
      }>)
        if (e.display_alias) aliasById.set(e.user_id, e.display_alias);
      const nameById = new Map<string, string>();
      for (const p of (projRes.data ?? []) as Array<{
        id: string;
        name: string | null;
      }>)
        if (p.name) nameById.set(p.id, p.name);
      setCalls(
        callRows.map((r) => ({
          id: r.id,
          slotStart: r.slot_start,
          projectName:
            (r.project_id && nameById.get(r.project_id)) || "your project",
          engineerName: aliasById.get(r.engineer_user_id) ?? "your engineer",
          engineerUserId: r.engineer_user_id,
          projectId: r.project_id,
        }))
      );
      setNowMs(Date.now());
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [customerUserId, tick]);

  const startCall = async (id: string) => {
    setBusyId(id);
    try {
      await createClient().rpc("start_appointment_call", { _booking_id: id });
      window.dispatchEvent(new Event("relay:appointment-started"));
      setTick((t) => t + 1);
    } finally {
      setBusyId(null);
    }
  };

  // Free the current slot, then open the scheduler to pick a new time —
  // same flow the sidebar used.
  const rescheduleCallNow = async (c: Call) => {
    if (callBusy) return;
    setCallBusy(true);
    try {
      const { error } = await createClient().rpc("reschedule_booking", {
        _id: c.id,
      });
      if (error) {
        window.alert(`Couldn't reschedule: ${error.message}`);
        return;
      }
      setOpenCallId(null);
      setRescheduleCall(c);
      setTick((t) => t + 1);
      window.dispatchEvent(new Event("relay:scheduled-changed"));
    } finally {
      setCallBusy(false);
    }
  };

  const cancelCallNow = async (c: Call) => {
    const reason = cancelCallReason.trim();
    if (callBusy || !reason) return;
    setCallBusy(true);
    try {
      const { error } = await createClient().rpc("cancel_booking_with_reason", {
        _id: c.id,
        _reason: reason,
      });
      if (error) {
        window.alert(`Couldn't cancel: ${error.message}`);
        return;
      }
      setCancelCallFor(null);
      setCancelCallReason("");
      setOpenCallId(null);
      setTick((t) => t + 1);
      window.dispatchEvent(new Event("relay:scheduled-changed"));
    } finally {
      setCallBusy(false);
    }
  };

  // Always available, regardless of the list state — rescheduling frees the
  // slot, which empties the list; the modal must still render so the customer
  // can pick a new time.
  const rescheduleModal = rescheduleCall ? (
    <ScheduleEngineerModal
      engineerUserId={rescheduleCall.engineerUserId}
      engineerName={rescheduleCall.engineerName}
      projectId={rescheduleCall.projectId}
      onClose={() => {
        setRescheduleCall(null);
        setTick((t) => t + 1);
      }}
      onBooked={() => {
        setRescheduleCall(null);
        setTick((t) => t + 1);
      }}
    />
  ) : null;

  if (loading) {
    return (
      <>
        <p
          className="py-12 text-center text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          Loading…
        </p>
        {rescheduleModal}
      </>
    );
  }

  if (appts.length === 0 && calls.length === 0) {
    return (
      <>
        <p
          className="py-12 text-center text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          Nothing scheduled right now.
        </p>
        {rescheduleModal}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Search */}
        <div
          className="flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
          style={{
            borderColor: "var(--border)",
            background: "var(--background)",
          }}
        >
          <Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scheduled…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
            style={{ color: "var(--text)" }}
          />
        </div>

        {shownAppts.length === 0 && shownCalls.length === 0 && (
          <p
            className="py-8 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            No scheduled items match &ldquo;{query}&rdquo;.
          </p>
        )}

        {shownAppts.length > 0 && (
          <section>
            <SectionLabel>Scheduled appointments</SectionLabel>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {shownAppts.map((a) => {
                const started = !!a.callStartedAt;
                const canStart =
                  nowMs > 0 && nowMs >= new Date(a.slotStart).getTime();
                return (
                  <Row
                    key={a.id}
                    title={a.projectName ?? "Appointment"}
                    subtitle={fmtWhen(a.slotStart)}
                    highlight={started || canStart}
                    action={
                      started ? (
                        <Badge>In call</Badge>
                      ) : (
                        <button
                          type="button"
                          disabled={!canStart || busyId === a.id}
                          onClick={() => void startCall(a.id)}
                          title={
                            canStart
                              ? "Start the call"
                              : "Available at the scheduled time"
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-default"
                          style={
                            canStart
                              ? {
                                  background: "var(--green-dot)",
                                  color: "#fff",
                                }
                              : {
                                  border: "1px solid var(--border)",
                                  color: "var(--text-muted)",
                                }
                          }
                        >
                          {busyId === a.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Phone size={11} />
                          )}
                          Call
                        </button>
                      )
                    }
                  />
                );
              })}
            </ul>
          </section>
        )}

        {shownCalls.length > 0 && (
          <section>
            <SectionLabel>Scheduled calls</SectionLabel>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {shownCalls.map((c) => {
                const expanded = openCallId === c.id;
                const canceling = cancelCallFor === c.id;
                return (
                  <li
                    key={c.id}
                    className="overflow-hidden rounded-xl border"
                    style={{
                      borderColor: expanded
                        ? "var(--primary)"
                        : "var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (expanded) {
                          setOpenCallId(null);
                          setCancelCallFor(null);
                        } else setOpenCallId(c.id);
                      }}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    >
                      <span
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: "var(--primary-soft)",
                          color: "var(--primary)",
                        }}
                      >
                        <CalendarClock size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[14px] font-medium"
                          style={{ color: "var(--text)" }}
                        >
                          {c.projectName}
                        </div>
                        <div
                          className="text-[12px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {fmtWhen(c.slotStart)} · {c.engineerName}
                        </div>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                        style={{ color: "var(--text-faint)" }}
                      />
                    </button>

                    {expanded && (
                      <div className="px-4 pb-3">
                        {canceling ? (
                          <div className="flex flex-col gap-2">
                            <span
                              className="text-[10px] font-semibold tracking-wider uppercase"
                              style={{ color: "var(--text-muted)" }}
                            >
                              Reason for cancelling{" "}
                              <span style={{ color: "var(--risk)" }}>*</span>
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {CANCEL_REASONS.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setCancelCallReason(r)}
                                  className="rounded-full border px-2 py-0.5 text-[10px] transition-colors"
                                  style={{
                                    borderColor:
                                      cancelCallReason === r
                                        ? "var(--primary)"
                                        : "var(--border)",
                                    color:
                                      cancelCallReason === r
                                        ? "var(--primary)"
                                        : "var(--text-muted)",
                                    background:
                                      cancelCallReason === r
                                        ? "var(--primary-soft)"
                                        : "transparent",
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
                            <textarea
                              value={cancelCallReason}
                              onChange={(e) =>
                                setCancelCallReason(e.target.value)
                              }
                              rows={2}
                              placeholder="Tell your engineer why (required)…"
                              className="w-full resize-none rounded-lg border px-2 py-1.5 text-[11px] outline-none"
                              style={{
                                borderColor: "var(--border)",
                                background: "var(--background)",
                                color: "var(--text)",
                              }}
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={callBusy || !cancelCallReason.trim()}
                                onClick={() => void cancelCallNow(c)}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                style={{ background: "var(--accent-red)" }}
                              >
                                {callBusy ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <X size={12} />
                                )}
                                Cancel call
                              </button>
                              <button
                                type="button"
                                disabled={callBusy}
                                onClick={() => {
                                  setCancelCallFor(null);
                                  setCancelCallReason("");
                                }}
                                className="rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                                style={{
                                  borderColor: "var(--border)",
                                  color: "var(--text-muted)",
                                }}
                              >
                                Back
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              disabled={callBusy}
                              onClick={() => void rescheduleCallNow(c)}
                              title="Free this slot and pick a new time"
                              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--text)",
                              }}
                            >
                              {callBusy ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              Reschedule
                            </button>
                            <button
                              type="button"
                              disabled={callBusy}
                              onClick={() => {
                                setCancelCallFor(c.id);
                                setCancelCallReason("");
                              }}
                              title="Cancel this scheduled call"
                              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--text-muted)",
                              }}
                            >
                              <X size={11} />
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      {rescheduleModal}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[11px] font-semibold tracking-wider uppercase"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </h2>
  );
}

function Row({
  title,
  subtitle,
  action,
  highlight,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <li
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
      >
        <CalendarClock size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[14px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {title}
        </div>
        <div
          className="text-[12px]"
          style={{
            color: highlight ? "var(--green-dot)" : "var(--text-muted)",
          }}
        >
          {subtitle}
        </div>
      </div>
      {action}
    </li>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
      style={{ background: "var(--green-dot)", color: "#fff" }}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-white" />
      {children}
    </span>
  );
}
