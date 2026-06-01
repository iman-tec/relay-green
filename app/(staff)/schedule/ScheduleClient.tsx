"use client";

/*
 * Supervisor appointment book. Lists the upcoming 30-minute calls customers
 * booked off a bid (Contract management → "Ask for appointment"), grouped
 * Today / Tomorrow / later. Each row shows the slot time, the customer, and
 * the project. The supervisor can drop a slot (e.g. a no-show) to free it.
 *
 * Backed by supervisor_bookings (RLS already scopes SELECT to the supervisor's
 * own rows). Times are stored UTC and rendered in the supervisor's local zone.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, User, FolderOpen, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Booking = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerName: string | null;
  projectName: string | null;
  callStartedAt: string | null;
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

function bucketLabel(slotStart: string): string {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = startOfDay(new Date(slotStart));
  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === tomorrow.getTime()) return "Tomorrow";
  return day.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function ScheduleClient() {
  const [sb] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to re-fetch

  // Load (inline so the fetch's setState lives in the effect, lint-clean).
  // Re-runs whenever `tick` changes — realtime + cancel just bump it.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      setUserId(u.user.id);
      const { data } = await sb
        .from("supervisor_bookings")
        .select(
          "id, slot_start, slot_end, customer_name, project_name, call_started_at"
        )
        .eq("supervisor_user_id", u.user.id)
        .eq("status", "booked")
        .gte("slot_end", new Date().toISOString())
        .order("slot_start", { ascending: true });
      if (!alive) return;
      setRows(
        (
          (data ?? []) as Array<{
            id: string;
            slot_start: string;
            slot_end: string;
            customer_name: string | null;
            project_name: string | null;
            call_started_at: string | null;
          }>
        ).map((r) => ({
          id: r.id,
          slotStart: r.slot_start,
          slotEnd: r.slot_end,
          customerName: r.customer_name,
          projectName: r.project_name,
          callStartedAt: r.call_started_at,
        }))
      );
      setLoading(false);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [sb, tick]);

  // supervisor_bookings isn't in the realtime publication, so poll every 15s to
  // surface a customer who has started their call (the bell notifies instantly).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const ch = sb
      .channel("relay-supervisor-schedule")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "supervisor_bookings",
          filter: `supervisor_user_id=eq.${userId}`,
        },
        () => setTick((t) => t + 1)
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, userId]);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await sb.rpc("cancel_supervisor_booking", { _id: id });
      setTick((t) => t + 1);
    } finally {
      setCancelling(null);
    }
  };

  // Group consecutive rows by day bucket (rows already sorted by slot_start).
  const groups = useMemo(() => {
    const out: { label: string; items: Booking[] }[] = [];
    for (const b of rows) {
      const label = bucketLabel(b.slotStart);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(b);
      else out.push({ label, items: [b] });
    }
    return out;
  }, [rows]);

  return (
    <div className="mx-auto flex min-h-full max-w-screen-xl flex-col px-8 py-8">
      <header className="mb-6 flex items-baseline gap-3">
        <CalendarClock size={16} style={{ color: "var(--primary)" }} />
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          Schedule
        </h1>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Appointments customers booked with you
        </span>
      </header>

      {loading ? (
        <div
          className="flex flex-1 items-center justify-center gap-2"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading appointments…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
          <span
            className="mb-4 flex size-12 items-center justify-center rounded-full"
            style={{ background: "var(--primary-soft)" }}
          >
            <CalendarClock size={22} style={{ color: "var(--primary)" }} />
          </span>
          <p
            className="text-[15px] font-medium"
            style={{ color: "var(--text)" }}
          >
            No upcoming appointments
          </p>
          <p
            className="mt-1.5 max-w-xs text-[13px] leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            When a customer books a call from one of your bids, it&apos;ll show
            up here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2
                className="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                {g.label}
              </h2>
              <ul className="flex flex-col gap-2">
                {g.items.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 rounded-xl border px-4 py-3"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--surface)",
                    }}
                  >
                    <span
                      className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-semibold tabular-nums"
                      style={{
                        background: "var(--primary-soft)",
                        color: "var(--primary)",
                      }}
                    >
                      {new Date(b.slotStart).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" – "}
                      {new Date(b.slotEnd).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="flex items-center gap-1.5 truncate text-[13px]"
                        style={{ color: "var(--text)" }}
                      >
                        <User
                          size={12}
                          style={{ color: "var(--text-muted)" }}
                        />
                        {b.customerName ?? "Customer"}
                      </div>
                      {b.projectName && (
                        <div
                          className="flex items-center gap-1.5 truncate text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <FolderOpen size={11} /> {b.projectName}
                        </div>
                      )}
                    </div>
                    {b.callStartedAt && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          background: "var(--green-dot)",
                          color: "#fff",
                        }}
                      >
                        <span className="size-1.5 animate-pulse rounded-full bg-white" />
                        Live — customer waiting
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void cancel(b.id)}
                      disabled={cancelling === b.id}
                      title="Drop this appointment"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/[0.03]"
                      style={{
                        borderColor: "var(--border)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {cancelling === b.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <X size={12} />
                      )}{" "}
                      Drop
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
