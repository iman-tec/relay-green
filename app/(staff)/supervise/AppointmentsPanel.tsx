"use client";

/*
 * Supervisor "Appointments" surface.
 *
 *   - AppointmentsPanel   — the Live-operations "Appointments" tab. Lists the
 *     supervisor's booked appointments (supervisor_bookings), split into
 *     "Live now" (the customer has started the call) and "Scheduled" (upcoming).
 *   - LiveAppointmentsSection — the same live appointments rendered as a section
 *     pinned to the top of the "All" tab (so a started appointment shows up in
 *     ALL the moment it begins, never before).
 *   - AppointmentTile — the shared card. Once a call has started the supervisor
 *     can add an engineer who has worked on the project (engineers_for_project →
 *     add_engineer_to_appointment, which notifies that engineer only).
 *
 * Appointments aren't auto-assigned to an engineer; the supervisor owns them.
 * supervisor_bookings isn't in the realtime publication, so these self-fetch +
 * poll on a short interval.
 */

import { useEffect, useState } from "react";
import {
  CalendarClock,
  User,
  FolderOpen,
  Loader2,
  UserPlus,
  Check,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export type SupervisorAppt = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerName: string | null;
  projectName: string | null;
  projectId: string | null;
  callStartedAt: string | null;
  engineerInvitedId: string | null;
  engineerInvitedName: string | null;
};

const SELECT =
  "id, slot_start, slot_end, customer_name, project_name, project_id, call_started_at, engineer_invited_id, engineer_invited_name";

type Row = {
  id: string;
  slot_start: string;
  slot_end: string;
  customer_name: string | null;
  project_name: string | null;
  project_id: string | null;
  call_started_at: string | null;
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

// ── Shared card ───────────────────────────────────────────────────────────
function AppointmentTile({
  appt,
  onChanged,
}: {
  appt: SupervisorAppt;
  onChanged: () => void;
}) {
  const [sb] = useState(() => createClient());
  const [picking, setPicking] = useState(false);
  const [engineers, setEngineers] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const live = !!appt.callStartedAt;

  const openPicker = async () => {
    setPicking(true);
    if (engineers === null && appt.projectId) {
      const { data } = await sb.rpc("engineers_for_project", {
        _project_id: appt.projectId,
      });
      setEngineers(
        (
          (data ?? []) as Array<{
            engineer_user_id: string;
            full_name: string | null;
          }>
        ).map((e) => ({
          id: e.engineer_user_id,
          name: e.full_name ?? "Engineer",
        }))
      );
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
    <div
      className="flex flex-col gap-2 rounded-xl border p-3"
      style={{
        borderColor: live ? "var(--green-dot)" : "var(--border)",
        background: live
          ? "color-mix(in srgb, var(--green-dot) 7%, transparent)"
          : "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2">
        <User size={13} style={{ color: "var(--text-muted)" }} />
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {appt.customerName ?? "Customer"}
        </span>
        {live ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: "var(--green-dot)", color: "#fff" }}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-white" />{" "}
            Live
          </span>
        ) : (
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Scheduled
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-1.5 text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <FolderOpen size={11} />
        <span className="truncate">{appt.projectName ?? "Project"}</span>
      </div>
      <div
        className="flex items-center gap-1.5 text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <CalendarClock size={11} />
        {fmtWhen(appt.slotStart)}
      </div>

      {/* Engineer: invited state, or the add control (live calls only). */}
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
              <Loader2 size={12} className="animate-spin" /> Loading engineers…
            </div>
          ) : engineers.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              No engineers have worked on this project yet.
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
                {busy ? "Adding…" : "Choose an engineer…"}
              </option>
              {engineers.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.name}
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
      ) : null}
    </div>
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

// ── Live-only section, pinned atop the All tab ────────────────────────────
export function LiveAppointmentsSection() {
  const [sb] = useState(() => createClient());
  const [appts, setAppts] = useState<SupervisorAppt[]>([]);
  const [tick, setTick] = useState(0);

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
        .not("call_started_at", "is", null)
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

  if (appts.length === 0) return null;
  return (
    <SectionGrid title="Appointments" count={appts.length}>
      {appts.map((a) => (
        <AppointmentTile
          key={a.id}
          appt={a}
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
  const liveAppts = appts.filter((a) => a.callStartedAt);
  const scheduled = appts.filter((a) => !a.callStartedAt);

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
            <AppointmentTile key={a.id} appt={a} onChanged={reload} />
          ))}
        </SectionGrid>
      )}
      {scheduled.length > 0 && (
        <SectionGrid title="Scheduled" count={scheduled.length}>
          {scheduled.map((a) => (
            <AppointmentTile key={a.id} appt={a} onChanged={reload} />
          ))}
        </SectionGrid>
      )}
    </div>
  );
}
