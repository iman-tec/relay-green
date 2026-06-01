"use client";

/*
 * Customer sidebar block that pairs Contract management with the customer's
 * upcoming appointments.
 *
 * Behaviour the product wants:
 *   - No appointment  → Contract management renders normally (expanded).
 *   - Has appointment → Contract management collapses (header + reopen button),
 *     and an "Appointment scheduled" section appears below it, so the booked
 *     call takes visual priority.
 *
 * Each appointment carries a call button that stays muted until the scheduled
 * time arrives, then turns green ("Start appointment call"). Clicking it calls
 * start_appointment_call, which notifies ONLY the supervisor (not engineers).
 *
 * Data: supervisor_bookings, RLS-scoped to the customer's own rows.
 */

import { useEffect, useState } from "react";
import { CalendarClock, Phone, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ContractManagement } from "./ContractManagement";

type Appt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  projectName: string | null;
  callStartedAt: string | null;
};

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

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select("id, slot_start, slot_end, project_name, call_started_at")
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
          }>
        ).map((r) => ({
          id: r.id,
          slotStart: r.slot_start,
          slotEnd: r.slot_end,
          projectName: r.project_name,
          callStartedAt: r.call_started_at,
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

  const hasAppt = appts.length > 0;

  return (
    <>
      <ContractManagement collapsedByDefault={hasAppt} />

      {hasAppt && (
        <section
          className="mt-2 rounded-xl border"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
          }}
        >
          <header className="flex items-center gap-1.5 px-3 py-2">
            <CalendarClock size={12} style={{ color: "var(--primary)" }} />
            <h3
              className="text-[12px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              Appointment scheduled
            </h3>
            {appts.length > 1 && (
              <span
                className="text-[10px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {appts.length}
              </span>
            )}
          </header>
          <ul className="border-t" style={{ borderColor: "var(--border)" }}>
            {appts.map((a) => {
              const started = !!a.callStartedAt;
              // 1-min tolerance, matching the RPC's TOO_EARLY guard.
              const canStart =
                nowMs > 0 && nowMs >= new Date(a.slotStart).getTime() - 60_000;
              const busy = busyId === a.id;
              return (
                <li key={a.id}>
                  <div
                    className="border-t px-3 py-2 first:border-t-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-md"
                        style={{
                          background: "var(--primary-soft)",
                          color: "var(--primary)",
                        }}
                      >
                        <CalendarClock size={10} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[11.5px] leading-tight"
                          style={{ color: "var(--text)" }}
                        >
                          {a.projectName ?? "Appointment"}
                        </div>
                        <div
                          className="truncate text-[10px] leading-tight"
                          style={{
                            color: started
                              ? "var(--green-dot)"
                              : canStart
                                ? "var(--green-dot)"
                                : "var(--text-muted)",
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

                    <div className="mt-1.5 flex justify-end">
                      {started ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
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
                            canStart
                              ? "Start appointment call"
                              : "Available at the scheduled time"
                          }
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-default"
                          style={
                            canStart
                              ? {
                                  background: "var(--green-dot)",
                                  color: "#fff",
                                }
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
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
