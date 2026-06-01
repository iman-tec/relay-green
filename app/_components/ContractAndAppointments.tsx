"use client";

/*
 * Customer sidebar block that pairs Contract management with the customer's
 * upcoming appointments.
 *
 * Behaviour the product wants:
 *   - No appointment  → Contract management renders normally (expanded).
 *   - Has appointment → Contract management collapses (header + reopen button),
 *     and an "Appointments" section appears below it, so the booked call takes
 *     visual priority.
 *
 * The appointment list has a Daily / Weekly filter (Weekly is the default —
 * "everything coming up this week"; Daily narrows to today). Each appointment
 * is a self-contained card with a full-width primary action (Start appointment
 * call — muted until the slot time, green once it's time) plus Change
 * (reschedule) and Cancel (with a reason box) underneath. Stacking the actions
 * vertically keeps them legible in the narrow sidebar instead of cramming
 * three buttons onto one row.
 *
 * Data: supervisor_bookings, RLS-scoped to the customer's own rows.
 */

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Phone,
  Loader2,
  RefreshCw,
  X,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ContractManagement } from "./ContractManagement";
import { SupervisorScheduleModal } from "./SupervisorScheduleModal";

type Appt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  projectName: string | null;
  callStartedAt: string | null;
  quoteId: string | null;
};

// Quick-pick reasons that pre-fill the free-text box. The box stays editable
// so the customer can refine or write their own.
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

export function ContractAndAppointments({
  contractsOpen,
  onContractsToggle,
  appointmentsOpen,
  onAppointmentsToggle,
}: {
  /** Accordion state owned by the Sidebar — opening one of the sidebar's
   *  collapsible bars collapses the others. */
  contractsOpen: boolean;
  onContractsToggle: () => void;
  appointmentsOpen: boolean;
  onAppointmentsToggle: () => void;
}) {
  const [sb] = useState(() => createClient());
  const [appts, setAppts] = useState<Appt[]>([]);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  // Which appointment's inline cancel panel is open + the typed reason.
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Which appointment row has its Change/Cancel actions expanded (toggled by
  // clicking the project name). Collapsed by default.
  const [actionsFor, setActionsFor] = useState<string | null>(null);

  // When set, the reschedule modal is open for this appointment (booking it
  // anew replaces the existing one via book_supervisor_slot's _replace_id).
  const [reschedule, setReschedule] = useState<{
    quoteId: string;
    projectName: string;
    bookingId: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select(
          "id, slot_start, slot_end, project_name, call_started_at, quote_id"
        )
        .eq("customer_user_id", u.user.id)
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
    };
    void load();
    return () => {
      alive = false;
    };
  }, [sb, tick]);

  // Live clock so the call button flips green the moment the slot time arrives.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The bid viewer fires this (via window event) after a (re)schedule so the
  // appointment list refreshes without a page reload.
  useEffect(() => {
    const onChanged = () => setTick((t) => t + 1);
    window.addEventListener("relay:appointments-changed", onChanged);
    return () =>
      window.removeEventListener("relay:appointments-changed", onChanged);
  }, []);

  const startCall = async (id: string) => {
    setBusyId(id);
    try {
      await sb.rpc("start_appointment_call", { _booking_id: id });
      setTick((t) => t + 1);
      // Tell the room to (re)load the active session so the customer drops into
      // the newly-created appointment session's waiting room.
      window.dispatchEvent(new Event("relay:appointment-started"));
    } finally {
      setBusyId(null);
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

  const confirmCancel = async (id: string) => {
    setCancelId(id);
    try {
      const reason = cancelReason.trim() || null;
      // Prefer the reason-capturing RPC. If it isn't deployed yet (live DB
      // drift), fall back to the plain cancel so the action still works —
      // the reason is simply not recorded in that case.
      let { error } = await sb.rpc("cancel_supervisor_booking_with_reason", {
        _id: id,
        _reason: reason,
      });
      if (
        error &&
        /(does not exist|could not find|42883|schema cache|PGRST202)/i.test(
          `${error.message ?? ""} ${(error as { code?: string }).code ?? ""}`
        )
      ) {
        ({ error } = await sb.rpc("cancel_supervisor_booking", { _id: id }));
      }
      if (error) {
        window.alert(`Couldn't cancel: ${error.message}`);
        return;
      }
      closeCancel();
      setTick((t) => t + 1);
      window.dispatchEvent(new Event("relay:appointments-changed"));
    } finally {
      setCancelId(null);
    }
  };

  return (
    <>
      <ContractManagement isOpen={contractsOpen} onToggle={onContractsToggle} />

      <section
        className="mt-4 overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <button
          type="button"
          onClick={onAppointmentsToggle}
          aria-expanded={appointmentsOpen}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
        >
          <CalendarClock size={12} style={{ color: "var(--primary)" }} />
          <span
            className="flex-1 text-[12px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            Appointments
          </span>
          <span
            className="text-[10px] font-medium tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {appts.length}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${appointmentsOpen ? "rotate-180" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        </button>

        {appointmentsOpen && appts.length === 0 && (
          <p
            className="border-t px-3 py-3 text-[11px]"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            No appointments yet.
          </p>
        )}
        {appointmentsOpen && appts.length > 0 && (
          <ul className="border-t" style={{ borderColor: "var(--border)" }}>
            {appts.map((a) => {
              const started = !!a.callStartedAt;
              // Goes live exactly at the slot time — no early tolerance. The
              // RPC's TOO_EARLY guard is more lenient (1-min grace), so this
              // just gates the UI to the precise appointment moment.
              const canStart =
                nowMs > 0 && nowMs >= new Date(a.slotStart).getTime();
              const busy = busyId === a.id;
              const canceling = cancelId === a.id;
              const cancelOpen = cancelFor === a.id;
              return (
                <li
                  key={a.id}
                  className="border-t px-3 py-2.5 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  {/* Identity row */}
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
                    {/* Inline call action — small, right of the project name. */}
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

                  {/* Action area below the identity row:
                          • cancelling → reason box
                          • otherwise  → Change / Cancel
                          (the call action + "In call" live inline above) */}
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
                          onClick={() => void confirmCancel(a.id)}
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
                      {/* Change + Cancel, two equal columns. */}
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
          </ul>
        )}
      </section>

      {reschedule && (
        <SupervisorScheduleModal
          quoteId={reschedule.quoteId}
          projectName={reschedule.projectName}
          replaceBookingId={reschedule.bookingId}
          onClose={() => setReschedule(null)}
          onBooked={() => {
            setReschedule(null);
            setTick((t) => t + 1);
            window.dispatchEvent(new Event("relay:appointments-changed"));
          }}
        />
      )}
    </>
  );
}
