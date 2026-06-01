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
import {
  CalendarClock,
  Loader2,
  User,
  FolderOpen,
  X,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Avatar } from "@/app/_components/ui";

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
        <>
          <div className="flex flex-col items-center justify-center py-12 text-center">
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
              When a customer books a call from one of your bids, it&apos;ll
              show up here.
            </p>
          </div>
          <TeamSchedule />
        </>
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
          <TeamSchedule />
        </div>
      )}
    </div>
  );
}

// ── Team schedule (pod engineers' bookings) ─────────────────────────────────
// The supervisor's own appointments live in supervisor_bookings (above). Their
// pod engineers' customer↔engineer appointments live in engineer_bookings and
// are served pod-scoped by GET /api/supervisor/bookings. Here we group them by
// engineer, page through each engineer's booked dates with the ">" control,
// and let the supervisor drop any slot (supervisor_cancel_engineer_booking).
type TeamBooking = {
  id: string;
  engineer: string;
  engineerId: string;
  customer: string;
  project: string | null;
  slotStart: string;
  slotEnd: string;
  status: string;
};

type EngineerGroup = {
  engineerId: string;
  engineer: string;
  dates: { key: string; label: string; slots: TeamBooking[] }[];
};

const localDateKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const timeRange = (a: string, b: string) =>
  `${new Date(a).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${new Date(
    b
  ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

function TeamSchedule() {
  const [sb] = useState(() => createClient());
  const [rows, setRows] = useState<TeamBooking[] | null>(null);
  const [tick, setTick] = useState(0);
  // Per-engineer active date index (the ">" pager advances this, wrapping).
  const [dateIdx, setDateIdx] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<TeamBooking | null>(null);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/supervisor/bookings", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          bookings?: TeamBooking[];
        };
        // Keep only live, not-yet-finished bookings. Snapshot "now" here (in
        // the effect) rather than in the grouping memo, which must stay pure.
        const now = Date.now();
        const future = (body.bookings ?? []).filter(
          (b) => b.status === "booked" && new Date(b.slotEnd).getTime() >= now
        );
        if (alive) setRows(future);
      } catch {
        if (alive) setRows([]);
      }
    })();
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sb, tick]);

  const groups = useMemo<EngineerGroup[]>(() => {
    if (!rows) return [];
    const byEng = new Map<string, TeamBooking[]>();
    for (const b of rows) {
      const arr = byEng.get(b.engineerId) ?? [];
      arr.push(b);
      byEng.set(b.engineerId, arr);
    }
    const out: EngineerGroup[] = [];
    for (const [engineerId, items] of byEng) {
      const byDate = new Map<string, TeamBooking[]>();
      for (const b of items) {
        const k = localDateKey(b.slotStart);
        const arr = byDate.get(k) ?? [];
        arr.push(b);
        byDate.set(k, arr);
      }
      const dates = [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, slots]) => ({
          key,
          label: dateLabel(slots[0].slotStart),
          slots: [...slots].sort((x, y) =>
            x.slotStart.localeCompare(y.slotStart)
          ),
        }));
      out.push({ engineerId, engineer: items[0].engineer, dates });
    }
    out.sort((a, b) => a.engineer.localeCompare(b.engineer));
    return out;
  }, [rows]);

  const drop = async () => {
    if (!selected) return;
    setDropping(true);
    setError(null);
    try {
      const { error: e } = await sb.rpc("supervisor_cancel_engineer_booking", {
        _id: selected.id,
        _reason: reason.trim() || null,
      });
      if (e) throw new Error(e.message);
      setSelected(null);
      setReason("");
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't drop the slot.");
    } finally {
      setDropping(false);
    }
  };

  if (rows === null) {
    return (
      <div
        className="mt-10 flex items-center gap-2 py-6"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading team schedule…</span>
      </div>
    );
  }
  // Only render once at least one team engineer has a booked slot.
  if (groups.length === 0) return null;

  const GRID =
    "grid grid-cols-[minmax(0,1.1fr)_auto_minmax(0,2fr)_auto] items-center gap-3";

  return (
    <section className="mt-10">
      <h2
        className="mb-1 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        Team schedule
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: "var(--text-faint)" }}>
        Appointments booked with engineers in your pod. Click a slot to drop it.
      </p>

      {/* Drop confirmation bar — pinned at the top of the table. */}
      {selected && (
        <div
          className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: "var(--accent-red)",
            background: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
          }}
        >
          <AlertTriangle size={15} style={{ color: "var(--accent-red)" }} />
          <span className="text-[13px]" style={{ color: "var(--text)" }}>
            Drop the {timeRange(selected.slotStart, selected.slotEnd)} call —{" "}
            <strong>{selected.engineer}</strong> · {selected.customer}?
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="h-8 min-w-[160px] flex-1 rounded-md border px-2 text-[12px] outline-none"
            style={{
              borderColor: "var(--border)",
              background: "var(--background)",
              color: "var(--text)",
            }}
          />
          <button
            type="button"
            onClick={() => void drop()}
            disabled={dropping}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--accent-red)" }}
          >
            {dropping ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <X size={12} />
            )}{" "}
            Drop
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setReason("");
            }}
            disabled={dropping}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="mb-3 text-[12px]" style={{ color: "var(--accent-red)" }}>
          {error}
        </p>
      )}

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div
          className={`${GRID} border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wider`}
          style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
        >
          <span>Engineer</span>
          <span>Date</span>
          <span>Slots</span>
          <span className="text-right">Next</span>
        </div>
        {groups.map((g) => {
          const idx = (dateIdx[g.engineerId] ?? 0) % g.dates.length;
          const active = g.dates[idx];
          return (
            <div
              key={g.engineerId}
              className={`${GRID} border-b px-4 py-3 last:border-b-0`}
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={g.engineer} size="sm" />
                <span
                  className="truncate text-[13px] font-medium"
                  style={{ color: "var(--text)" }}
                >
                  {g.engineer}
                </span>
              </div>
              <div
                className="whitespace-nowrap text-[12px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {active.label}
                {g.dates.length > 1 && (
                  <span
                    className="ml-1 text-[10px]"
                    style={{ color: "var(--text-faint)" }}
                  >
                    ({idx + 1}/{g.dates.length})
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {active.slots.map((s) => {
                  const isSel = selected?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(isSel ? null : s)}
                      title={`Click to drop · ${s.customer}${s.project ? " · " + s.project : ""}`}
                      className="rounded-lg border px-2.5 py-1 text-[12px] font-medium tabular-nums transition-colors"
                      style={{
                        borderColor: isSel
                          ? "var(--accent-red)"
                          : "var(--border)",
                        background: isSel
                          ? "color-mix(in srgb, var(--accent-red) 12%, transparent)"
                          : "var(--surface-raised)",
                        color: isSel ? "var(--accent-red)" : "var(--text)",
                      }}
                    >
                      {timeRange(s.slotStart, s.slotEnd)}
                    </button>
                  );
                })}
              </div>
              <div className="text-right">
                <button
                  type="button"
                  disabled={g.dates.length <= 1}
                  onClick={() =>
                    setDateIdx((m) => ({
                      ...m,
                      [g.engineerId]:
                        ((m[g.engineerId] ?? 0) + 1) % g.dates.length,
                    }))
                  }
                  aria-label="Next date"
                  title="Next booked date"
                  className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
                  style={{ color: "var(--text)" }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
