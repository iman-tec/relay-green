"use client";

/*
 * Supervisor "Appointments" surface.
 *
 *   - AppointmentsPanel   — the Live-operations "Appointments" tab. Lists the
 *     supervisor's booked appointments (supervisor_bookings), split into
 *     "Live now" (the customer has started the call), "Due now" (the slot time
 *     has arrived but the customer hasn't started yet), and "Scheduled"
 *     (still in the future).
 *   - LiveAppointmentsSection — the live + due appointments rendered as a
 *     section pinned to the top of the "All" tab, so an appointment shows up in
 *     ALL the moment it becomes actionable (its slot time arrives), not only
 *     once the customer presses start.
 *   - AppointmentTile — the shared card. Styled to match the board's SessionTile
 *     (Card + left accent bar + StatusBadge + waiting glow). Once a call is live
 *     the supervisor can open the session, or add an engineer who has worked on
 *     the project (engineers_for_project → add_engineer_to_appointment).
 *
 * Appointments aren't auto-assigned to an engineer; the supervisor owns them.
 * supervisor_bookings isn't in the realtime publication, so these self-fetch +
 * poll on a short interval, plus a `now` tick so the due/live transition is
 * picked up live as a slot time passes.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  User,
  FolderOpen,
  Loader2,
  UserPlus,
  Check,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Card, StatusBadge, cn } from "@/app/_components/ui";

export type SupervisorAppt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerName: string | null;
  projectName: string | null;
  projectId: string | null;
  callStartedAt: string | null;
  sessionId: string | null;
  engineerInvitedId: string | null;
  engineerInvitedName: string | null;
};

const SELECT =
  "id, slot_start, slot_end, customer_name, project_name, project_id, call_started_at, session_id, engineer_invited_id, engineer_invited_name";

type Row = {
  id: string;
  slot_start: string;
  slot_end: string;
  customer_name: string | null;
  project_name: string | null;
  project_id: string | null;
  call_started_at: string | null;
  session_id: string | null;
  engineer_invited_id: string | null;
  engineer_invited_name: string | null;
};

const mapRow = (r: Row): SupervisorAppt => ({
  id: r.id,
  slotStart: r.slot_start,
  slotEnd: r.slot_end,
  customerName: r.customer_name,
  projectName: r.project_name,
  projectId: r.project_id,
  callStartedAt: r.call_started_at,
  sessionId: r.session_id,
  engineerInvitedId: r.engineer_invited_id,
  engineerInvitedName: r.engineer_invited_name,
});

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// State of an appointment relative to "now":
//   live      — the customer has started the call (a session exists)
//   due       — the slot time has arrived but nobody has started yet
//   scheduled — still in the future
type ApptState = "live" | "due" | "scheduled";
const apptState = (a: SupervisorAppt, now: number): ApptState => {
  if (a.callStartedAt) return "live";
  if (now > 0 && new Date(a.slotStart).getTime() <= now) return "due";
  return "scheduled";
};

// `now` snapshot that ticks on an interval so the due/live transition is
// picked up as a slot time passes. Seeded lazily, then updated only inside the
// interval callback (never synchronously in the effect body).
function useNowMs(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Shared card (matches the board's SessionTile) ──────────────────────────
function AppointmentTile({
  appt,
  now,
  onChanged,
}: {
  appt: SupervisorAppt;
  now: number;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [sb] = useState(() => createClient());
  const [picking, setPicking] = useState(false);
  const [engineers, setEngineers] = useState<
    { id: string; name: string; busy: boolean }[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  const state = apptState(appt, now);
  const live = state === "live";
  const due = state === "due";
  const glow = live || due;
  const glowColor = live ? "var(--ok)" : "var(--primary)";
  const accent = live ? "var(--ok)" : due ? "var(--primary)" : "var(--border)";
  const tone = live ? "ok" : due ? "info" : "neutral";
  const stateLabel = live ? "Live" : due ? "Due now" : "Scheduled";

  const canOpen = live && !!appt.sessionId;
  const openSession = () => {
    if (canOpen) router.push(`/staff/session/${appt.sessionId}`);
  };

  // Offer every assignable engineer (same source as the Matching board's
  // manual-assign), not just engineers who have already worked the project —
  // the appointment add-engineer flow now rings anyone (add_engineer_to_appointment).
  const openPicker = async () => {
    setPicking(true);
    if (engineers === null) {
      try {
        const res = await fetch("/api/staff/assignable-engineers", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({ engineers: [] }))) as {
          engineers?: Array<{
            userId: string;
            displayName: string;
            busy: boolean;
          }>;
        };
        setEngineers(
          (body.engineers ?? []).map((e) => ({
            id: e.userId,
            name: e.displayName,
            busy: e.busy,
          }))
        );
      } catch {
        setEngineers([]);
      }
    }
  };

  const addEngineer = async (engineerId: string) => {
    setBusy(true);
    try {
      await sb.rpc("add_engineer_to_appointment", {
        _booking_id: appt.id,
        _engineer_user_id: engineerId,
      });
      setPicking(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      variant="surface"
      interactive={canOpen}
      onClick={canOpen ? openSession : undefined}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openSession();
              }
            }
          : undefined
      }
      className={cn("group relative p-4", glow && "relay-card-glow")}
      style={
        glow ? ({ ["--glow"]: glowColor } as React.CSSProperties) : undefined
      }
    >
      {/* Left accent bar — colour tracks the state (green live / coral due). */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pl-1">
        <StatusBadge tone={tone} compact>
          {stateLabel}
        </StatusBadge>
        <span
          className="relay-appt-tag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
          style={{ background: "var(--risk)", color: "#fff" }}
        >
          <CalendarClock size={10} /> Appointment
        </span>
      </div>

      <div className="flex items-center gap-2 pl-1">
        <User size={14} style={{ color: "var(--text-muted)" }} />
        <span
          className="min-w-0 flex-1 truncate text-[14px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {appt.customerName ?? "Customer"}
        </span>
      </div>

      <div
        className="mt-1 flex items-center gap-1.5 pl-1 text-[12px]"
        style={{ color: "var(--text-muted)" }}
      >
        <FolderOpen size={12} />
        <span className="truncate">{appt.projectName ?? "Project"}</span>
      </div>
      <div
        className="mt-0.5 flex items-center gap-1.5 pl-1 text-[12px]"
        style={{ color: "var(--text-muted)" }}
      >
        <CalendarClock size={12} />
        {fmtWhen(appt.slotStart)}
      </div>

      {/* Action area — stop click-through so the engineer picker / button
          doesn't also navigate to the session. */}
      <div className="mt-3 pl-1" onClick={(e) => e.stopPropagation()}>
        {appt.engineerInvitedId ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <Check size={12} style={{ color: "var(--green-dot)" }} />
            Engineer added: {appt.engineerInvitedName ?? "Engineer"}
          </div>
        ) : live ? (
          picking ? (
            engineers === null ? (
              <div
                className="flex items-center gap-1.5 text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                <Loader2 size={12} className="animate-spin" /> Loading
                engineers…
              </div>
            ) : engineers.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                No engineers available to assign.
              </p>
            ) : (
              <select
                autoFocus
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) void addEngineer(e.target.value);
                }}
                className="h-8 w-full rounded-md border px-2 text-[11px]"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--background)",
                  color: "var(--text)",
                }}
              >
                <option value="" disabled>
                  {busy ? "Ringing…" : "Choose an engineer to ring…"}
                </option>
                {engineers.map((eng) => (
                  <option key={eng.id} value={eng.id} disabled={eng.busy}>
                    {eng.name}
                    {eng.busy ? " · on a call" : ""}
                  </option>
                ))}
              </select>
            )
          ) : (
            <button
              type="button"
              onClick={() => void openPicker()}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
              style={{
                borderColor: "var(--green-dot)",
                color: "var(--green-dot)",
              }}
            >
              <UserPlus size={12} /> Add engineer
            </button>
          )
        ) : due ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Waiting for the customer to join…
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function SectionGrid({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2
          className="text-sm font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </h2>
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          ({count})
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

// ── Live + due section, pinned atop the All tab ───────────────────────────
export function LiveAppointmentsSection() {
  const [sb] = useState(() => createClient());
  const [appts, setAppts] = useState<SupervisorAppt[]>([]);
  const [tick, setTick] = useState(0);
  const now = useNowMs(10_000);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select(SELECT)
        .eq("supervisor_user_id", u.user.id)
        .eq("status", "booked")
        .gte("slot_end", new Date(Date.now() - 2 * 3600_000).toISOString())
        .order("slot_start", { ascending: true });
      if (!alive) return;
      setAppts(((data ?? []) as Row[]).map(mapRow));
    };
    void load();
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sb, tick]);

  // Active = anything the supervisor can act on now (live OR due). Live first.
  const active = appts
    .filter((a) => apptState(a, now) !== "scheduled")
    .sort((a, b) => {
      const rank = (x: SupervisorAppt) => (apptState(x, now) === "live" ? 0 : 1);
      return rank(a) - rank(b) || a.slotStart.localeCompare(b.slotStart);
    });

  if (active.length === 0) return null;
  return (
    <SectionGrid title="Appointments" count={active.length}>
      {active.map((a) => (
        <AppointmentTile
          key={a.id}
          appt={a}
          now={now}
          onChanged={() => setTick((t) => t + 1)}
        />
      ))}
    </SectionGrid>
  );
}

// ── Appointments tab ──────────────────────────────────────────────────────
export function AppointmentsPanel() {
  const [sb] = useState(() => createClient());
  const [appts, setAppts] = useState<SupervisorAppt[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const now = useNowMs(10_000);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select(SELECT)
        .eq("supervisor_user_id", u.user.id)
        .eq("status", "booked")
        .gte("slot_end", new Date(Date.now() - 2 * 3600_000).toISOString())
        .order("slot_start", { ascending: true });
      if (!alive) return;
      setAppts(((data ?? []) as Row[]).map(mapRow));
      setLoading(false);
    };
    void load();
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sb, tick]);

  const reload = () => setTick((t) => t + 1);
  const liveAppts = appts.filter((a) => apptState(a, now) === "live");
  const dueAppts = appts.filter((a) => apptState(a, now) === "due");
  const scheduled = appts.filter((a) => apptState(a, now) === "scheduled");

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2
          size={16}
          className="animate-spin"
          style={{ color: "var(--text-muted)" }}
        />
      </div>
    );
  }
  if (appts.length === 0) {
    return (
      <div
        className="rounded-2xl border px-6 py-12 text-center"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <CalendarClock
          size={22}
          className="mx-auto mb-3"
          style={{ color: "var(--text-faint)" }}
        />
        <p className="text-sm" style={{ color: "var(--text)" }}>
          No appointments scheduled.
        </p>
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
          When a customer books a call from a bid, it shows up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {liveAppts.length > 0 && (
        <SectionGrid title="Live now" count={liveAppts.length}>
          {liveAppts.map((a) => (
            <AppointmentTile key={a.id} appt={a} now={now} onChanged={reload} />
          ))}
        </SectionGrid>
      )}
      {dueAppts.length > 0 && (
        <SectionGrid title="Due now" count={dueAppts.length}>
          {dueAppts.map((a) => (
            <AppointmentTile key={a.id} appt={a} now={now} onChanged={reload} />
          ))}
        </SectionGrid>
      )}
      {scheduled.length > 0 && (
        <SectionGrid title="Scheduled" count={scheduled.length}>
          {scheduled.map((a) => (
            <AppointmentTile key={a.id} appt={a} now={now} onChanged={reload} />
          ))}
        </SectionGrid>
      )}
    </div>
  );
}
