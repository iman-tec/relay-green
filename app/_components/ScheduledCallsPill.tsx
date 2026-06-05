"use client";

/*
 * "Scheduled Calls" sidebar pill — ONE borderless collapsible that merges:
 *   • Appointments (supervisor_bookings) — shown FIRST (priority): each can be
 *     started at slot time, rescheduled, or cancelled (with a reason).
 *   • Scheduled engineer calls (engineer_bookings) — reschedule / cancel.
 *
 * Borderless + hover-highlight (Claude-style). Renders nothing when the
 * customer has neither an upcoming appointment nor a scheduled call.
 *
 * Consolidates the former ScheduledSessionsBox + the Appointments section of
 * ContractAndAppointments into a single pill.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ArrowRight,
  Loader2,
  Phone,
  RefreshCw,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SupervisorScheduleModal } from "./SupervisorScheduleModal";

export type RescheduleTarget = {
  engineerUserId: string;
  engineerName: string;
  projectId: string | null;
};

type ScheduledBooking = {
  id: string;
  engineerUserId: string;
  engineerName: string;
  projectId: string | null;
  projectName: string;
  slotStart: string;
  slotEnd: string;
};

type Appt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  projectName: string | null;
  callStartedAt: string | null;
  quoteId: string | null;
};

// Quick-pick reasons that pre-fill the cancel note (the box stays editable).
const CANCEL_REASONS = [
  "Something came up",
  "No longer needed",
  "Wrong time — will rebook",
  "Issue already resolved",
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const ScheduledCallsPill = memo(function ScheduledCallsPill({
  customerUserId,
  onReschedule,
  open,
  onToggle,
  onNavigate,
}: {
  customerUserId: string | null;
  /** Reopen the scheduler for the same engineer/project after the slot is
   *  freed. Wired to the Sidebar's scheduleTarget state. */
  onReschedule: (target: RescheduleTarget) => void;
  open: boolean;
  onToggle: () => void;
  /** When set, the pill is a NAV button (→) that opens the center pane instead
   *  of expanding inline. The inline list is suppressed in this mode. */
  onNavigate?: () => void;
}) {
  const sbRef = useRef(createClient());

  // ── Scheduled engineer calls (engineer_bookings) ───────────────────────
  const [bookings, setBookings] = useState<ScheduledBooking[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadCalls = useCallback(async (uid: string) => {
    const sb = sbRef.current;
    // Keep a slot visible until 10 min past its end (matches AppointmentPopup
    // grace) so a just-started/at-slot booking doesn't vanish mid-flow.
    const fromIso = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data } = await sb
      .from("engineer_bookings")
      .select("id, engineer_user_id, project_id, slot_start, slot_end")
      .eq("customer_user_id", uid)
      .eq("status", "booked")
      .gte("slot_end", fromIso)
      .order("slot_start", { ascending: true });
    const rows = (data ?? []) as Array<{
      id: string;
      engineer_user_id: string;
      project_id: string | null;
      slot_start: string;
      slot_end: string;
    }>;
    if (rows.length === 0) {
      setBookings([]);
      return;
    }
    const engIds = [...new Set(rows.map((r) => r.engineer_user_id))];
    const projIds = [
      ...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x)),
    ];
    const [engRes, projRes] = await Promise.all([
      sb
        .from("engineer_profiles")
        .select("user_id, display_alias")
        .in("user_id", engIds),
      projIds.length
        ? sb.from("projects").select("id, name").in("id", projIds)
        : Promise.resolve({ data: [] }),
    ]);
    const aliasById = new Map<string, string>();
    for (const e of (engRes.data ?? []) as Array<{
      user_id: string;
      display_alias: string | null;
    }>) {
      if (e.display_alias) aliasById.set(e.user_id, e.display_alias);
    }
    const nameById = new Map<string, string>();
    for (const p of (projRes.data ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      if (p.name) nameById.set(p.id, p.name);
    }
    setBookings(
      rows.map((r) => ({
        id: r.id,
        engineerUserId: r.engineer_user_id,
        engineerName: aliasById.get(r.engineer_user_id) ?? "your engineer",
        projectId: r.project_id,
        projectName:
          (r.project_id && nameById.get(r.project_id)) || "your project",
        slotStart: r.slot_start,
        slotEnd: r.slot_end,
      }))
    );
  }, []);

  useEffect(() => {
    if (!customerUserId) return;
    const sb = sbRef.current;
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      await loadCalls(customerUserId);
      if (!alive) return;
      const channel = sb
        .channel(`sidebar-bookings-${customerUserId}-${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_bookings",
            filter: `customer_user_id=eq.${customerUserId}`,
          },
          () => {
            void loadCalls(customerUserId);
          }
        )
        .subscribe();
      if (!alive) {
        void sb.removeChannel(channel);
        return;
      }
      ch = channel;
    })();
    return () => {
      alive = false;
      if (ch) void sb.removeChannel(ch);
    };
  }, [customerUserId, loadCalls]);

  const handleRescheduleCall = useCallback(
    async (b: ScheduledBooking) => {
      if (busyId) return;
      setBusyId(b.id);
      try {
        const { error } = await sbRef.current.rpc("reschedule_booking", {
          _id: b.id,
        });
        if (error) {
          window.alert(`Couldn't reschedule: ${error.message}`);
          return;
        }
        setBookings((prev) => prev.filter((x) => x.id !== b.id));
        onReschedule({
          engineerUserId: b.engineerUserId,
          engineerName: b.engineerName,
          projectId: b.projectId,
        });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, onReschedule]
  );

  const handleCancelCall = useCallback(
    async (b: ScheduledBooking) => {
      if (busyId) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Cancel this scheduled session? Your engineer will be notified."
        )
      )
        return;
      setBusyId(b.id);
      try {
        const { error } = await sbRef.current.rpc(
          "cancel_booking_with_reason",
          {
            _id: b.id,
            _reason: "Cancelled by customer",
          }
        );
        if (error) {
          window.alert(`Couldn't cancel: ${error.message}`);
          return;
        }
        setBookings((prev) => prev.filter((x) => x.id !== b.id));
      } finally {
        setBusyId(null);
      }
    },
    [busyId]
  );

  // ── Appointments (supervisor_bookings) ─────────────────────────────────
  const [appts, setAppts] = useState<Appt[]>([]);
  const [apptTick, setApptTick] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [apptBusyId, setApptBusyId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<{
    quoteId: string;
    projectName: string;
    bookingId: string;
  } | null>(null);

  useEffect(() => {
    if (!customerUserId) return;
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data } = await sb
        .from("supervisor_bookings")
        .select(
          "id, slot_start, slot_end, project_name, call_started_at, quote_id"
        )
        .eq("customer_user_id", customerUserId)
        .eq("status", "booked")
        .gte("slot_end", new Date().toISOString())
        .order("slot_start", { ascending: true });
      if (!alive) return;
      setAppts(
        (
          (data ?? []) as Array<{
            id: string;
            slot_start: string;
            slot_end: string;
            project_name: string | null;
            call_started_at: string | null;
            quote_id: string | null;
          }>
        ).map((r) => ({
          id: r.id,
          slotStart: r.slot_start,
          slotEnd: r.slot_end,
          projectName: r.project_name,
          callStartedAt: r.call_started_at,
          quoteId: r.quote_id,
        }))
      );
      setNowMs(Date.now());
    })();
    return () => {
      alive = false;
    };
  }, [customerUserId, apptTick]);

  // Live clock so the call button flips green the moment the slot time arrives.
  // PERF: only tick while there's an un-started appointment to count down to —
  // otherwise (no appts, or all in-call) we skip the per-second re-render.
  const hasPendingAppt = appts.some((a) => !a.callStartedAt);
  useEffect(() => {
    if (!hasPendingAppt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasPendingAppt]);

  // The bid viewer fires this after a (re)schedule so the list refreshes.
  useEffect(() => {
    const onApptChanged = () => setApptTick((t) => t + 1);
    // Any booking made/cancelled in-app (engineer call OR appointment) refreshes
    // both lists instantly — no reload, no wait on DB realtime.
    const onScheduledChanged = () => {
      setApptTick((t) => t + 1);
      if (customerUserId) void loadCalls(customerUserId);
    };
    window.addEventListener("relay:appointments-changed", onApptChanged);
    window.addEventListener("relay:scheduled-changed", onScheduledChanged);
    return () => {
      window.removeEventListener("relay:appointments-changed", onApptChanged);
      window.removeEventListener("relay:scheduled-changed", onScheduledChanged);
    };
  }, [customerUserId, loadCalls]);

  const startCall = async (id: string) => {
    setApptBusyId(id);
    try {
      await sbRef.current.rpc("start_appointment_call", { _booking_id: id });
      setApptTick((t) => t + 1);
      window.dispatchEvent(new Event("relay:appointment-started"));
    } finally {
      setApptBusyId(null);
    }
  };

  const openCancel = (id: string) => {
    setCancelFor(id);
    setCancelReason("");
  };
  const closeCancel = () => {
    setCancelFor(null);
    setCancelReason("");
  };

  const confirmCancelAppt = async (id: string) => {
    setCancelId(id);
    try {
      const reason = cancelReason.trim() || null;
      // Prefer the reason-capturing RPC; fall back to the plain cancel if it
      // isn't deployed yet (live DB drift) so the action still works.
      let { error } = await sbRef.current.rpc(
        "cancel_supervisor_booking_with_reason",
        { _id: id, _reason: reason }
      );
      if (
        error &&
        /(does not exist|could not find|42883|schema cache|PGRST202)/i.test(
          `${error.message ?? ""} ${(error as { code?: string }).code ?? ""}`
        )
      ) {
        ({ error } = await sbRef.current.rpc("cancel_supervisor_booking", {
          _id: id,
        }));
      }
      if (error) {
        window.alert(`Couldn't cancel: ${error.message}`);
        return;
      }
      closeCancel();
      setApptTick((t) => t + 1);
      window.dispatchEvent(new Event("relay:appointments-changed"));
    } finally {
      setCancelId(null);
    }
  };

  // Hidden entirely when there's nothing scheduled (per the pill spec).
  const total = appts.length + bookings.length;
  if (total === 0) return null;

  return (
    <div className="px-2 py-1">
      <div className="overflow-hidden rounded-xl">
        <button
          type="button"
          onClick={onNavigate ?? onToggle}
          aria-expanded={onNavigate ? undefined : open}
          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
        >
          <CalendarClock size={12} style={{ color: "var(--primary)" }} />
          <span
            className="flex-1 text-[12px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            Scheduled Calls
          </span>
          <span
            className="text-[10px] font-medium tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {total}
          </span>
          {onNavigate ? (
            <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown
              size={14}
              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              style={{ color: "var(--text-muted)" }}
            />
          )}
        </button>

        {open && !onNavigate && (
          <ul className="mt-0.5">
            {/* Appointments first — priority. */}
            {appts.map((a) => {
              const started = !!a.callStartedAt;
              const canStart =
                nowMs > 0 && nowMs >= new Date(a.slotStart).getTime();
              const busy = apptBusyId === a.id;
              const canceling = cancelId === a.id;
              const cancelOpen = cancelFor === a.id;
              return (
                <li key={`appt-${a.id}`} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: "var(--primary-soft)",
                        color: "var(--primary)",
                      }}
                    >
                      <CalendarClock size={12} />
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (actionsFor === a.id) {
                          setActionsFor(null);
                          closeCancel();
                        } else {
                          setActionsFor(a.id);
                        }
                      }}
                      aria-expanded={actionsFor === a.id}
                      title="Show appointment options"
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className="flex items-center gap-1 truncate text-[12px] leading-tight font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        <span className="truncate">
                          {a.projectName ?? "Appointment"}
                        </span>
                        <span
                          className="shrink-0 rounded px-1 text-[8px] font-bold tracking-wide uppercase"
                          style={{
                            background: "var(--primary-soft)",
                            color: "var(--primary)",
                          }}
                        >
                          Appt
                        </span>
                        <ChevronDown
                          size={12}
                          className={`shrink-0 transition-transform ${actionsFor === a.id ? "rotate-180" : ""}`}
                          style={{ color: "var(--text-muted)" }}
                        />
                      </div>
                      <div
                        className="truncate text-[10.5px] leading-tight"
                        style={{
                          color:
                            started || canStart
                              ? "var(--green-dot)"
                              : "var(--text-muted)",
                        }}
                      >
                        {fmtWhen(a.slotStart)}
                      </div>
                    </button>
                    {started ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                        style={{
                          background: "var(--green-dot)",
                          color: "#fff",
                        }}
                      >
                        <span className="size-1.5 animate-pulse rounded-full bg-white" />
                        In call
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canStart || busy}
                        onClick={() => void startCall(a.id)}
                        title={
                          canStart ? "Call" : "Available at the scheduled time"
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:cursor-default"
                        style={
                          canStart
                            ? { background: "var(--green-dot)", color: "#fff" }
                            : {
                                border: "1px solid var(--border)",
                                color: "var(--text-muted)",
                                background: "transparent",
                              }
                        }
                      >
                        {busy ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Phone size={10} />
                        )}
                        Call
                      </button>
                    )}
                  </div>

                  {started ? null : cancelOpen ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <span
                        className="text-[10px] font-semibold tracking-wider uppercase"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Reason for cancelling
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {CANCEL_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setCancelReason(r)}
                            className="rounded-full border px-2 py-0.5 text-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            style={{
                              borderColor:
                                cancelReason === r
                                  ? "var(--primary)"
                                  : "var(--border)",
                              color:
                                cancelReason === r
                                  ? "var(--primary)"
                                  : "var(--text-muted)",
                              background:
                                cancelReason === r
                                  ? "var(--primary-soft)"
                                  : "transparent",
                            }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        rows={2}
                        placeholder="Add a note for your supervisor (optional)…"
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
                          disabled={canceling}
                          onClick={() => void confirmCancelAppt(a.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          style={{ background: "var(--accent-red)" }}
                        >
                          {canceling ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <X size={12} />
                          )}
                          Cancel appointment
                        </button>
                        <button
                          type="button"
                          disabled={canceling}
                          onClick={closeCancel}
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
                  ) : actionsFor === a.id ? (
                    <div className="mt-2">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={!a.quoteId || busy}
                          onClick={() =>
                            a.quoteId &&
                            setReschedule({
                              quoteId: a.quoteId,
                              projectName: a.projectName ?? "Appointment",
                              bookingId: a.id,
                            })
                          }
                          title="Change the appointment time"
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                          style={{
                            borderColor: "var(--border)",
                            color: "var(--text)",
                          }}
                        >
                          <RefreshCw size={11} />
                          Change
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openCancel(a.id)}
                          title="Cancel this appointment"
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
                    </div>
                  ) : null}
                </li>
              );
            })}

            {/* Scheduled engineer calls. */}
            {bookings.map((b) => {
              const rowOpen = openId === b.id;
              const busy = busyId === b.id;
              return (
                <li key={`call-${b.id}`} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: "var(--primary-soft)",
                        color: "var(--primary)",
                      }}
                    >
                      <Phone size={12} />
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenId(rowOpen ? null : b.id)}
                      aria-expanded={rowOpen}
                      title="Show options"
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className="flex items-center gap-1 truncate text-[12px] leading-tight font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        <span className="truncate">{b.projectName}</span>
                        <ChevronDown
                          size={12}
                          className={`shrink-0 transition-transform ${rowOpen ? "rotate-180" : ""}`}
                          style={{ color: "var(--text-muted)" }}
                        />
                      </div>
                      <div
                        className="truncate text-[10.5px] leading-tight"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {fmtWhen(b.slotStart)} · {b.engineerName}
                      </div>
                    </button>
                  </div>

                  {rowOpen && (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRescheduleCall(b)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text)",
                        }}
                        title="Free this slot and pick a new time"
                      >
                        {busy ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <RefreshCw size={11} />
                        )}
                        Reschedule
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleCancelCall(b)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-muted)",
                        }}
                        title="Cancel this scheduled session"
                      >
                        <X size={11} />
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {reschedule && (
        <SupervisorScheduleModal
          quoteId={reschedule.quoteId}
          projectName={reschedule.projectName}
          replaceBookingId={reschedule.bookingId}
          onClose={() => setReschedule(null)}
          onBooked={() => {
            setReschedule(null);
            setApptTick((t) => t + 1);
            window.dispatchEvent(new Event("relay:appointments-changed"));
          }}
        />
      )}
    </div>
  );
});
