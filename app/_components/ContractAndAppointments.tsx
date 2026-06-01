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

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Phone, Loader2, RefreshCw, X } from "lucide-react";
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

type RangeFilter = "daily" | "weekly";

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
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function ContractAndAppointments() {
  const [sb] = useState(() => createClient());
  const [appts, setAppts] = useState<Appt[]>([]);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  // Daily / Weekly view. Weekly is the default — the customer's mental model
  // is "what's on this week", with Daily as a focus mode for today.
  const [range, setRange] = useState<RangeFilter>("weekly");

  // Which appointment's inline cancel panel is open + the typed reason.
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // When set, the reschedule modal is open for this appointment (booking it
  // anew replaces the existing one via book_supervisor_slot's _replace_id).
  const [reschedule, setReschedule] = useState<
    { quoteId: string; projectName: string; bookingId: string } | null
  >(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select("id, slot_start, slot_end, project_name, call_started_at, quote_id")
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

  const hasAppt = appts.length > 0;

  // Apply the Daily / Weekly filter. Daily = slots that start today; Weekly =
  // slots that start within the next 7 days (today included). Past-but-not-yet-
  // ended slots (slot already underway) always stay visible so an in-progress
  // call isn't filtered out from under the customer.
  const visible = useMemo(() => {
    if (nowMs === 0) return appts;
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const endMs =
      range === "daily" ? startMs + 24 * 60 * 60_000 : startMs + 7 * 24 * 60 * 60_000;
    return appts.filter((a) => {
      const s = new Date(a.slotStart).getTime();
      const e = new Date(a.slotEnd).getTime();
      // Underway right now → always show. Otherwise must start within range.
      if (s <= nowMs && e > nowMs) return true;
      return s >= startMs && s < endMs;
    });
  }, [appts, range, nowMs]);

  return (
    <>
      <ContractManagement collapsedByDefault={hasAppt} />

      {hasAppt && (
        <section
          className="mt-2 overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {/* Header: title + count, with the Daily/Weekly segmented filter. */}
          <header
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          >
            <CalendarClock size={13} style={{ color: "var(--primary)" }} />
            <h3 className="flex-1 text-[12px] font-semibold" style={{ color: "var(--text)" }}>
              Appointments
            </h3>
            <SegmentedFilter value={range} onChange={setRange} />
          </header>

          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
              {range === "daily"
                ? "No appointments today."
                : "No appointments this week."}
            </p>
          ) : (
            <ul>
              {visible.map((a) => {
                const started = !!a.callStartedAt;
                // 1-min tolerance, matching the RPC's TOO_EARLY guard.
                const canStart =
                  nowMs > 0 && nowMs >= new Date(a.slotStart).getTime() - 60_000;
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
                        style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                      >
                        <CalendarClock size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[12px] font-medium leading-tight"
                          style={{ color: "var(--text)" }}
                        >
                          {a.projectName ?? "Appointment"}
                        </div>
                        <div
                          className="truncate text-[10.5px] leading-tight"
                          style={{
                            color: started || canStart ? "var(--green-dot)" : "var(--text-muted)",
                          }}
                        >
                          {started
                            ? "Call in progress"
                            : canStart
                              ? "It's time — start your call"
                              : fmtWhen(a.slotStart)}
                        </div>
                      </div>
                    </div>

                    {/* Action area — three mutually-exclusive states:
                          • in call           → "In call" pill
                          • cancelling         → reason box
                          • otherwise          → Start (primary) + Change/Cancel */}
                    {started ? (
                      <div className="mt-2">
                        <span
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold"
                          style={{ background: "var(--green-dot)", color: "#fff" }}
                        >
                          <span className="size-1.5 animate-pulse rounded-full bg-white" />
                          In call
                        </span>
                      </div>
                    ) : cancelOpen ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
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
                                  cancelReason === r ? "var(--primary)" : "var(--border)",
                                color: cancelReason === r ? "var(--primary)" : "var(--text-muted)",
                                background:
                                  cancelReason === r ? "var(--primary-soft)" : "transparent",
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
                            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {/* Primary: Start appointment call (full width). */}
                        <button
                          type="button"
                          disabled={!canStart || busy}
                          onClick={() => void startCall(a.id)}
                          title={
                            canStart ? "Start appointment call" : "Available at the scheduled time"
                          }
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors disabled:cursor-default"
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
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Phone size={12} />
                          )}
                          Start appointment call
                        </button>

                        {/* Secondary: Change + Cancel, two equal columns. */}
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
                            style={{ borderColor: "var(--border)", color: "var(--text)" }}
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
                            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                          >
                            <X size={11} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

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

// ── Daily / Weekly segmented control ────────────────────────────────────────
function SegmentedFilter({
  value,
  onChange,
}: {
  value: RangeFilter;
  onChange: (v: RangeFilter) => void;
}) {
  const opts: Array<{ key: RangeFilter; label: string }> = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
  ];
  return (
    <div
      className="inline-flex rounded-full border p-0.5"
      style={{ borderColor: "var(--border)", background: "var(--background)" }}
    >
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              background: active ? "var(--primary)" : "transparent",
              color: active ? "#fff" : "var(--text-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
