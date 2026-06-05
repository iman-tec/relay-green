"use client";

/*
 * SupervisorAppointmentToaster — global appointment pop-up.
 *
 * Mounted once in StaffShell (gated to supervisor-class users), so a customer
 * booking an appointment pops a toast at the top of WHATEVER staff screen the
 * supervisor is on — Inbox, Supervise, Operations, Bids, Schedule, Calendar —
 * not just /supervise. The SupervisorNotificationBell keeps the full history;
 * this is purely the transient "you've got an appointment" pop, auto-dismissing
 * after 5s.
 *
 * Driven by realtime INSERTs on public.notifications (RLS scopes them to the
 * caller). We read payload.new directly — the same pattern SupervisorAlerts
 * uses — so no fetch/poll is needed and only genuinely-new rows ever toast.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type ApptToast = { id: string; title: string; body: string | null };

// Notification kinds that pop a toast. Appointment bookings are the one the
// customer triggers directly; add more kinds here if other events should pop.
const TOAST_KINDS = new Set(["supervisor_appointment_booked"]);

export function SupervisorAppointmentToaster() {
  const sbRef = useRef(createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ApptToast[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let alive = true;
    void sbRef.current.auth.getUser().then(({ data }) => {
      if (alive && data.user) setUserId(data.user.id);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const sb = sbRef.current;
    // Per-mount channel suffix so Supabase's name-based dedupe never refuses a
    // re-subscribe after a fast remount (same guard SupervisorAlerts uses).
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`relay-appt-toaster-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as {
            id?: string;
            kind?: string;
            title?: string;
            body?: string | null;
          } | null;
          if (!n?.id || !n.kind || !TOAST_KINDS.has(n.kind)) return;
          const item: ApptToast = {
            id: n.id,
            title: n.title ?? "New appointment booked",
            body: n.body ?? null,
          };
          setToasts((prev) =>
            prev.some((t) => t.id === item.id)
              ? prev
              : [item, ...prev].slice(0, 3)
          );
          const timer = setTimeout(
            () => setToasts((prev) => prev.filter((t) => t.id !== item.id)),
            5000
          );
          timersRef.current.push(timer);
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [userId]);

  useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
    },
    []
  );

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {toasts.map((n) => (
        <div
          key={`appt-toast-${n.id}`}
          className="pointer-events-auto flex w-96 max-w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl"
          style={{
            animation: "relay-toast-in 220ms ease-out",
            background: "color-mix(in srgb, var(--surface) 62%, transparent)",
            borderColor: "color-mix(in srgb, var(--text) 14%, transparent)",
            backdropFilter: "blur(16px) saturate(1.5)",
            WebkitBackdropFilter: "blur(16px) saturate(1.5)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
          }}
        >
          <span
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <CalendarClock size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="text-[12.5px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              {n.title}
            </div>
            {n.body && (
              <div
                className="truncate text-[11.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                {n.body}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() =>
              setToasts((prev) => prev.filter((t) => t.id !== n.id))
            }
            className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
