"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { createClient } from "@/lib/supabase/browser";
import {
  Calendar as CalendarIcon,
  Loader2,
  MoreVertical,
  PhoneIncoming,
  X,
} from "lucide-react";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";

// ── Dashboard month stats ────────────────────────────────────────────────
// Five KPIs rendered in the bottom MonthStatsRow:
//   - callsTaken      ended sessions this calendar month
//   - uniqueCustomers distinct customers served (all-time, not month)
//   - goliveDone      go-live projects in completed/archived status
//   - goliveActive    go-live projects in active status
//   - maintaining     maintain-contract projects in active status
//
// All sourced from guest_calls (where the engineer is claimed_by) joined
// to projects for the contract_type + completion_status buckets.
// Falls back to zero on any error (e.g. the contract_type column missing
// pre-migration) so the dashboard never crashes on a fresh env.
type DashStats = {
  callsTaken: number;
  uniqueCustomers: number;
  goliveDone: number;
  goliveActive: number;
  maintaining: number;
};
function useDashboardStats(): DashStats {
  const [stats, setStats] = useState<DashStats>({
    callsTaken: 0,
    uniqueCustomers: 0,
    goliveDone: 0,
    goliveActive: 0,
    maintaining: 0,
  });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();
        const { data: u } = await sb.auth.getUser();
        const me = u.user?.id;
        if (!alive || !me) return;

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        // Single query pulls all the engineer's calls + their joined
        // projects. We bucket on the client because the buckets are
        // distinct-by-project (sets, not counts).
        const { data, error } = await sb
          .from("guest_calls")
          .select(
            "project_id, created_at, status, customer_user_id, projects(contract_type, completion_status)"
          )
          .eq("claimed_by", me);
        if (!alive) return;
        if (error) return; // schema not yet migrated — fail silent

        type Embed = {
          contract_type: string | null;
          completion_status: string | null;
        };
        type Row = {
          project_id: string | null;
          created_at: string;
          status: string;
          customer_user_id: string | null;
          projects: Embed | Embed[] | null;
        };
        const rows = (data ?? []) as unknown as Row[];

        let callsTaken = 0;
        const customers = new Set<string>();
        const goliveDone = new Set<string>();
        const goliveActive = new Set<string>();
        const maintaining = new Set<string>();

        for (const r of rows) {
          if (r.status === "ended" && new Date(r.created_at) >= monthStart)
            callsTaken++;
          if (r.customer_user_id) customers.add(r.customer_user_id);
          if (!r.project_id) continue;
          const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
          const ct = p?.contract_type;
          const cs = p?.completion_status;
          if (ct === "golive" && (cs === "completed" || cs === "archived"))
            goliveDone.add(r.project_id);
          if (ct === "golive" && cs === "active")
            goliveActive.add(r.project_id);
          if (ct === "maintain" && cs === "active")
            maintaining.add(r.project_id);
        }

        if (alive)
          setStats({
            callsTaken,
            uniqueCustomers: customers.size,
            goliveDone: goliveDone.size,
            goliveActive: goliveActive.size,
            maintaining: maintaining.size,
          });
      } catch {
        /* silent */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return stats;
}

// ── Incoming-section row shapes ─────────────────────────────────────────
type IncomingRequest = {
  id: string;
  customerUserId: string;
  projectId: string | null;
  message: string | null;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
};

type IncomingBooking = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerUserId: string;
  projectId: string | null;
  notes: string | null;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
};

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";

export function DashboardClient() {
  const router = useRouter();
  useRequireEngineerProfile();
  const { queue, loading, error, takeNext } = useEngineerWorkspace();

  // ── Incoming-for-you: pending connect requests + upcoming bookings ──
  // Surfaced ABOVE the existing queue because a customer who specifically
  // chose YOU (request or scheduled slot) outranks the anonymous queue.
  // Both lists realtime-sync so the engineer doesn't need to refresh.
  const sbRef = useRef(createClient());
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>(
    []
  );
  const [incomingBookings, setIncomingBookings] = useState<IncomingBooking[]>(
    []
  );
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Lookup helpers used to enrich the raw rows with customer / project
  // names. Pulled inline rather than via foreign-key embed because the
  // existing schema doesn't have an FK that PostgREST resolves to
  // customer_profiles cleanly.
  const enrichRequest = useCallback(
    async (row: {
      id: string;
      customer_user_id: string;
      project_id: string | null;
      message: string | null;
      created_at: string;
    }): Promise<IncomingRequest> => {
      const sb = sbRef.current;
      const [custRes, projRes] = await Promise.all([
        sb
          .from("customer_profiles")
          .select("display_name, email")
          .eq("user_id", row.customer_user_id)
          .maybeSingle(),
        row.project_id
          ? sb
              .from("projects")
              .select("name")
              .eq("id", row.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const cust = (custRes.data ?? null) as {
        display_name: string | null;
        email: string | null;
      } | null;
      const proj = (projRes.data ?? null) as { name: string | null } | null;
      return {
        id: row.id,
        customerUserId: row.customer_user_id,
        projectId: row.project_id,
        message: row.message,
        createdAt: row.created_at,
        customerName: cust?.display_name ?? null,
        customerEmail: cust?.email ?? null,
        projectName: proj?.name ?? null,
      };
    },
    []
  );

  const enrichBooking = useCallback(
    async (row: {
      id: string;
      slot_start: string;
      slot_end: string;
      customer_user_id: string;
      project_id: string | null;
      notes: string | null;
    }): Promise<IncomingBooking> => {
      const sb = sbRef.current;
      // Name comes from the customer_display_name RPC (SECURITY DEFINER), the
      // same path the booking notification uses — so it resolves regardless of
      // the engineer's RLS. (customer_profiles has no email column, so there's
      // no email to surface here.)
      const [nameRes, projRes] = await Promise.all([
        sb.rpc("customer_display_name", { _user_id: row.customer_user_id }),
        row.project_id
          ? sb
              .from("projects")
              .select("name")
              .eq("id", row.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const proj = (projRes.data ?? null) as { name: string | null } | null;
      return {
        id: row.id,
        slotStart: row.slot_start,
        slotEnd: row.slot_end,
        customerUserId: row.customer_user_id,
        projectId: row.project_id,
        notes: row.notes,
        customerName: (nameRes.data as string | null) ?? null,
        customerEmail: null,
        projectName: proj?.name ?? null,
      };
    },
    []
  );

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    // Channels are tracked at the effect scope so the cleanup function
    // (which IS the useEffect cleanup, unlike the async IIFE's return)
    // can actually call removeChannel on them. Prior code returned the
    // cleanup from inside the IIFE and lost it.
    let reqCh: ReturnType<typeof sb.channel> | null = null;
    let bkCh: ReturnType<typeof sb.channel> | null = null;

    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;

      // Pending requests (engineer Busy → customer pinged).
      const reqRes = await sb
        .from("engineer_connect_requests")
        .select("id, customer_user_id, project_id, message, created_at")
        .eq("engineer_user_id", me)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      // Upcoming bookings — fetched-ahead 30 days.
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      const bkRes = await sb
        .from("engineer_bookings")
        .select("id, slot_start, slot_end, customer_user_id, project_id, notes")
        .eq("engineer_user_id", me)
        .eq("status", "booked")
        .gte("slot_end", new Date(Date.now() - 15 * 60_000).toISOString())
        .lt("slot_start", horizon.toISOString())
        .order("slot_start", { ascending: true });

      if (!alive) return;
      const reqRows = (reqRes.data ?? []) as Array<{
        id: string;
        customer_user_id: string;
        project_id: string | null;
        message: string | null;
        created_at: string;
      }>;
      const bkRows = (bkRes.data ?? []) as Array<{
        id: string;
        slot_start: string;
        slot_end: string;
        customer_user_id: string;
        project_id: string | null;
        notes: string | null;
      }>;
      const [enrichedReq, enrichedBk] = await Promise.all([
        Promise.all(reqRows.map(enrichRequest)),
        Promise.all(bkRows.map(enrichBooking)),
      ]);
      if (!alive) return;
      setIncomingRequests(enrichedReq);
      setIncomingBookings(enrichedBk);

      // Per-mount UUID suffix on channel names — defends against Supabase's
      // name-based dedupe yelling "cannot add postgres_changes after
      // subscribe()" if a stale leaked channel collides with this fresh
      // mount.
      const suffix =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      // Realtime — connect-requests changes for this engineer.
      reqCh = sb
        .channel(`dash-requests-${me}-${suffix}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_connect_requests",
            filter: `engineer_user_id=eq.${me}`,
          },
          (payload) => {
            const next = payload.new as
              | ((typeof reqRows)[number] & { status?: string })
              | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingRequests((prev) => prev.filter((r) => r.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "pending") {
              setIncomingRequests((prev) =>
                prev.filter((r) => r.id !== next.id)
              );
              return;
            }
            void enrichRequest(next).then((enriched) => {
              if (!alive) return;
              setIncomingRequests((prev) => {
                const without = prev.filter((r) => r.id !== enriched.id);
                return [enriched, ...without].sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime()
                );
              });
            });
          }
        )
        .subscribe();

      // Realtime — bookings changes for this engineer.
      bkCh = sb
        .channel(`dash-bookings-${me}-${suffix}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_bookings",
            filter: `engineer_user_id=eq.${me}`,
          },
          (payload) => {
            const next = payload.new as
              | ((typeof bkRows)[number] & { status?: string })
              | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "booked") {
              setIncomingBookings((prev) =>
                prev.filter((b) => b.id !== next.id)
              );
              return;
            }
            // Past slots fall out of the list.
            if (new Date(next.slot_end).getTime() < Date.now() - 15 * 60_000) {
              setIncomingBookings((prev) =>
                prev.filter((b) => b.id !== next.id)
              );
              return;
            }
            void enrichBooking(next).then((enriched) => {
              if (!alive) return;
              setIncomingBookings((prev) => {
                const without = prev.filter((b) => b.id !== enriched.id);
                return [...without, enriched].sort(
                  (a, b) =>
                    new Date(a.slotStart).getTime() -
                    new Date(b.slotStart).getTime()
                );
              });
            });
          }
        )
        .subscribe();
    })();

    return () => {
      alive = false;
      if (reqCh) sb.removeChannel(reqCh);
      if (bkCh) sb.removeChannel(bkCh);
    };
  }, [enrichRequest, enrichBooking]);

  const onAcceptRequest = useCallback(
    async (req: IncomingRequest) => {
      if (actionBusyId) return;
      setActionBusyId(req.id);
      try {
        const sb = sbRef.current;
        const { error: rpcErr } = await sb.rpc("accept_connect_request", {
          _id: req.id,
        });
        if (rpcErr) {
          window.alert(`Couldn't accept: ${rpcErr.message}`);
          return;
        }
        setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
      } finally {
        setActionBusyId(null);
      }
    },
    [actionBusyId]
  );

  const onDeclineRequest = useCallback(
    async (req: IncomingRequest) => {
      if (actionBusyId) return;
      setActionBusyId(req.id);
      try {
        const sb = sbRef.current;
        const { error: rpcErr } = await sb.rpc("decline_connect_request", {
          _id: req.id,
        });
        if (rpcErr) {
          window.alert(`Couldn't decline: ${rpcErr.message}`);
          return;
        }
        setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
      } finally {
        setActionBusyId(null);
      }
    },
    [actionBusyId]
  );

  const onCancelBooking = useCallback(
    async (b: IncomingBooking) => {
      if (actionBusyId) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm("Cancel this booking? The customer will be notified.")
      )
        return;
      setActionBusyId(b.id);
      try {
        const sb = sbRef.current;
        const { error: rpcErr } = await sb.rpc("cancel_booking", { _id: b.id });
        if (rpcErr) {
          window.alert(`Couldn't cancel: ${rpcErr.message}`);
          return;
        }
        setIncomingBookings((prev) => prev.filter((x) => x.id !== b.id));
      } finally {
        setActionBusyId(null);
      }
    },
    [actionBusyId]
  );

  const stats = useDashboardStats();

  // ALL upcoming customer bookings, grouped by calendar day, soonest day first
  // (and soonest slot first within a day) for the left-column ScheduledCallsBox.
  // Past slots (ended >15 min ago) are already filtered out by the parent fetch;
  // the fetch horizon is 30 days ahead. Day labels read "Today" / "Tomorrow" /
  // "Mon, Jun 8" so the spanning dates stay legible in the narrow column.
  const bookingDayGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKey = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const labelFor = (ms: number) => {
      const diffDays = Math.round((ms - today.getTime()) / 86_400_000);
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Tomorrow";
      return new Date(ms).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    };
    const byDay = new Map<number, IncomingBooking[]>();
    for (const b of incomingBookings) {
      const k = dayKey(new Date(b.slotStart));
      const arr = byDay.get(k);
      if (arr) arr.push(b);
      else byDay.set(k, [b]);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, list]) => ({
        key: ms,
        label: labelFor(ms),
        bookings: list
          .slice()
          .sort(
            (a, b) =>
              new Date(a.slotStart).getTime() -
              new Date(b.slotStart).getTime()
          ),
      }));
  }, [incomingBookings]);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 px-6 py-6">
      {/* ── Greeting + walk-in CTA. Walk-ins (anonymous queue) only
          surface here because the new 2-column layout below is reserved
          for SCHEDULED + CALLBACK calls per the engineer's mental model.
          See DashboardHeader comment for the trade-off. */}
      <DashboardHeader
        queueCount={queue.length}
        onTakeNext={async () => {
          const claimed = await takeNext();
          if (claimed) router.push(`/staff/session/${claimed.id}`);
        }}
      />

      {error && (
        <div
          className="rounded-md border px-4 py-2.5 text-sm"
          style={{
            borderColor:
              "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor:
              "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Two-column workspace.
          Left col (1/4): the Scheduled-upcoming box — a fixed-height card that
          scrolls internally rather than growing with the booking count.
          Right col (3/4): calendar, stretched to the same height as the box. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 lg:items-stretch">
        <div className="lg:col-span-1">
          <ScheduledCallsBox
            groups={bookingDayGroups}
            actionBusyId={actionBusyId}
            onCancel={onCancelBooking}
          />
        </div>
        <div className="lg:col-span-3">
          <FourWeekCalendar
            bookings={incomingBookings}
            actionBusyId={actionBusyId}
            onCancel={onCancelBooking}
          />
        </div>
      </div>

      {/* ── Month stats — five KPIs the engineer cares about: calls taken,
          unique customers, go-lives done/in-progress, maintain projects.
          Replaces the prior "Build minutes / Live now / Go-live / Maintain"
          strip with the metrics the engineer asked for. */}
      <MonthStatsRow stats={stats} />

      {/* Loading shell only on first paint, when nothing else is rendered. */}
      {loading && (
        <div className="flex justify-center py-6">
          <Loader2
            size={18}
            className="animate-spin"
            style={{ color: BRAND_GREEN }}
          />
        </div>
      )}

    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DashboardHeader — greeting line + inline presence pill + Take-next CTA.
// Replaces the prior "My Dashboard / Your sessions" header + standalone
// 3-card PresenceCard. Presence is realtime-synced with the top-right
// EngineerPresenceBadge so changes here mirror everywhere.
// ──────────────────────────────────────────────────────────────────────────
function DashboardHeader({
  queueCount,
  onTakeNext,
}: {
  queueCount: number;
  onTakeNext: () => void;
}) {
  const sbRef = useRef(createClient());
  const [name, setName] = useState<string>("");

  // Greeting source: profiles.full_name → first word; falls back to email
  // local-part. Loaded lazily; renders "engineer" until it arrives.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user;
      if (!alive || !me) return;
      const { data: prof } = await sb
        .from("profiles")
        .select("full_name")
        .eq("id", me.id)
        .maybeSingle();
      if (!alive) return;
      const full = (prof as { full_name?: string | null } | null)?.full_name;
      const first = full
        ? full.trim().split(/\s+/)[0]
        : (me.email ?? "").split("@")[0];
      setName(first || "engineer");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Header shows greeting + date. When the anonymous walk-in queue is
  // non-empty, a "Take next walk-in" CTA appears on the right — the only
  // surface that exposes walk-ins on the dashboard now that NowSection is
  // gone (scheduled + callbacks live in their own boxes below). The FIFO
  // auto-ring in StaffShell still handles the hands-off path.
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1
          className="text-[20px] leading-tight font-semibold"
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-source-serif)",
          }}
        >
          Hi {name ? capitalize(name) : "there"}
        </h1>
        <p
          className="mt-0.5 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          {dateLabel}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {queueCount > 0 && (
          <button
            type="button"
            onClick={onTakeNext}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <PhoneIncoming size={13} />
            Take next walk-in · {queueCount}
          </button>
        )}
        <NotificationBell
          endpoint="/api/engineer/notifications"
          channelKey="engineer"
          clearable
        />
      </div>
    </header>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ──────────────────────────────────────────────────────────────────────────
// ScheduledCallsBox — left-column box #1.
// ALL upcoming customer-PREBOOKED calls, grouped by day with the soonest day
// (and soonest slot) on top so the engineer's very next call is always at the
// top of the list. Bookings also live on the right-side MonthCalendar.
//
// Always renders even when empty — the engineer's mental model includes
// "is anything booked?" as a useful answer, not a hidden component.
// ──────────────────────────────────────────────────────────────────────────
function ScheduledCallsBox({
  groups,
  actionBusyId,
  onCancel,
}: {
  groups: { key: number; label: string; bookings: IncomingBooking[] }[];
  actionBusyId: string | null;
  onCancel: (b: IncomingBooking) => Promise<void>;
}) {
  const total = groups.reduce((n, g) => n + g.bookings.length, 0);
  return (
    <section
      // Fixed height so the card never grows with the booking count — the list
      // below scrolls internally instead.
      className="flex h-[460px] flex-col overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <CalendarIcon size={14} style={{ color: "#0ea5e9" }} />
        <h2
          className="flex-1 text-[12px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Scheduled · upcoming
        </h2>
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {total === 0 ? "none" : total}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {total === 0 ? (
          <div
            className="flex h-full items-center justify-center px-4 py-6 text-center text-[12px]"
            style={{ color: "var(--text-faint)" }}
          >
            No upcoming customer bookings.
          </div>
        ) : (
          groups.map((g) => (
            <ScheduledDayGroup
              key={g.key}
              label={g.label}
              bookings={g.bookings}
              actionBusyId={actionBusyId}
              onCancel={onCancel}
              emptyText=""
            />
          ))
        )}
      </div>
    </section>
  );
}

function ScheduledDayGroup({
  label,
  bookings,
  actionBusyId,
  onCancel,
  emptyText,
}: {
  label: string;
  bookings: IncomingBooking[];
  actionBusyId: string | null;
  onCancel: (b: IncomingBooking) => Promise<void>;
  emptyText: string;
}) {
  return (
    <div className="border-t" style={{ borderColor: "var(--border)" }}>
      <div
        className="px-4 pt-2 text-[10px] font-semibold tracking-wider uppercase"
        style={{ color: "var(--text-faint)" }}
      >
        {label} · {bookings.length}
      </div>
      {bookings.length === 0 ? (
        <div
          className="px-4 py-2 text-[12px]"
          style={{ color: "var(--text-faint)" }}
        >
          {emptyText}
        </div>
      ) : (
        <ul className="flex flex-col">
          {bookings
            .slice()
            .sort(
              (a, b) =>
                new Date(a.slotStart).getTime() -
                new Date(b.slotStart).getTime()
            )
            .map((b) => (
              <li key={b.id} className="px-4 py-2">
                <ScheduledRow
                  booking={b}
                  busy={actionBusyId === b.id}
                  onCancel={() => void onCancel(b)}
                />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// Compact booking row used inside ScheduledCallsBox. Different layout from
// the legacy BookingRow (which has a heavier presentation for the prior
// NowSection); this one is built for the narrow left column.
function ScheduledRow({
  booking,
  busy,
  onCancel,
}: {
  booking: IncomingBooking;
  busy: boolean;
  onCancel: () => void;
}) {
  const start = new Date(booking.slotStart);
  const end = new Date(booking.slotEnd);
  const name = booking.customerName ?? booking.customerEmail ?? "Customer";
  // Per-row actions live behind a small dropdown ("⋮") instead of a bare ×, so
  // the narrow column stays uncluttered and cancel can't be hit by accident.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: "#0ea5e9" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span
            className="font-semibold tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {start.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
            →{" "}
            {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <span
            className="truncate font-medium"
            style={{ color: "var(--text)" }}
          >
            {name}
          </span>
        </div>
        {booking.projectName && (
          <div
            className="truncate text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            {booking.projectName}
          </div>
        )}
        {booking.notes && (
          <div
            className="mt-0.5 text-[11px] italic"
            style={{ color: "var(--text-muted)" }}
          >
            &ldquo;{booking.notes}&rdquo;
          </div>
        )}
      </div>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          title="Booking actions"
          aria-label="Booking actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="rounded-md p-1 transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.04]"
          style={{ color: "var(--text-faint)" }}
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MoreVertical size={14} />
          )}
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[150px] overflow-hidden rounded-md border shadow-lg"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onCancel();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ color: "var(--accent-red)" }}
            >
              <X size={12} /> Cancel booking
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CallsWaitingBox — left-column box #2.
// Existing-customer callback requests: the engineer was Busy when the
// customer tried to reach them, and the customer chose to wait rather
// than book a slot. Distinct from the anonymous walk-in queue (which
// surfaces in the header CTA) because here there's a prior relationship
// and a specific message.
//
// Empty state is real estate ("no one's waiting" is a positive answer)
// so this box always renders.
// ──────────────────────────────────────────────────────────────────────────
function CallsWaitingBox({
  requests,
  actionBusyId,
  onAccept,
  onDecline,
}: {
  requests: IncomingRequest[];
  actionBusyId: string | null;
  onAccept: (r: IncomingRequest) => Promise<void>;
  onDecline: (r: IncomingRequest) => Promise<void>;
}) {
  return (
    <section
      className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border"
      style={{
        borderColor:
          requests.length > 0
            ? "color-mix(in srgb, " + URGENT_AMBER + " 38%, transparent)"
            : "var(--border)",
        backgroundColor:
          requests.length > 0
            ? "color-mix(in srgb, " + URGENT_AMBER + " 4%, var(--surface))"
            : "var(--surface)",
      }}
    >
      <header
        className="flex items-center gap-2 border-b px-4 py-3"
        style={{
          borderColor:
            requests.length > 0
              ? "color-mix(in srgb, " + URGENT_AMBER + " 28%, transparent)"
              : "var(--border)",
        }}
      >
        <PhoneIncoming
          size={14}
          style={{
            color: requests.length > 0 ? URGENT_AMBER : "var(--text-faint)",
          }}
        />
        <h2
          className="flex-1 text-[12px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: requests.length > 0 ? URGENT_AMBER : "var(--text)" }}
        >
          Calls waiting
        </h2>
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {requests.length === 0 ? "none" : requests.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {requests.length === 0 ? (
          <div
            className="flex h-full items-center justify-center px-4 py-6 text-center text-[12px]"
            style={{ color: "var(--text-faint)" }}
          >
            No callback requests right now.
          </div>
        ) : (
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                <WaitingRow
                  request={r}
                  busy={actionBusyId === r.id}
                  onAccept={() => void onAccept(r)}
                  onDecline={() => void onDecline(r)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WaitingRow({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: IncomingRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="border-t px-4 py-2.5"
      style={{
        borderColor:
          "color-mix(in srgb, " + URGENT_AMBER + " 18%, transparent)",
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className="text-[13px] font-semibold"
          style={{ color: "var(--text)" }}
        >
          {request.customerName ?? request.customerEmail ?? "Customer"}
        </span>
        {request.projectName && (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            · {request.projectName}
          </span>
        )}
        <span
          className="ml-auto text-[11px]"
          style={{ color: "var(--text-faint)" }}
        >
          {timeAgo(new Date(request.createdAt))}
        </span>
      </div>
      {request.message && (
        <p
          className="mt-1 text-[11px] italic"
          style={{ color: "var(--text-muted)" }}
        >
          &ldquo;{request.message}&rdquo;
        </p>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {busy ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <PhoneIncoming size={10} />
          )}
          Connect
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <X size={10} />
          Decline
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FourWeekCalendar — right-column primary surface.
//
// Fixed 4-week rolling view (28 cells, Sun–Sat × 4 rows). The first row
// is the week CONTAINING today, the next three are the following weeks.
// Past weeks aren't shown (engineer-stated requirement: "past days is of
// no use"); past days in the current week ARE shown but rendered as
// disabled/dimmed so the column alignment stays intact.
//
// Cell semantics:
//   - GREEN background      → engineer has an availability window
//   - RED background        → holiday / leave (no work that day)
//   - PLAIN background      → no window scheduled (e.g. weekend off)
//   - Today                 → primary outline + bolder day number
//   - Past (in current wk)  → 32% opacity, not clickable
//   - Booking count         → number in the cell when > 0
//
// Click handler: opens DayDetailModal with that day's scheduled calls.
//
// Reuses incomingBookings from the parent (already enriched with
// customer / project names + notes) rather than refetching. The parent's
// 30-day horizon covers our 28-day view comfortably.
// ──────────────────────────────────────────────────────────────────────────
function FourWeekCalendar({
  bookings,
  actionBusyId,
  onCancel,
}: {
  bookings: IncomingBooking[];
  actionBusyId: string | null;
  onCancel: (b: IncomingBooking) => Promise<void>;
}) {
  const sbRef = useRef(createClient());
  const todayMid = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // First cell = Sunday of the week containing today.
  const gridStart = useMemo(() => {
    const d = new Date(todayMid);
    d.setDate(d.getDate() - d.getDay()); // back to Sunday
    return d;
  }, [todayMid]);

  // 28 dates from gridStart.
  const dates = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [gridStart]);

  // Availability + holiday data spanning the 28-day window.
  type W = { weekday: number; startMinute: number; endMinute: number };
  type DW = { date: string };
  type H = { date: string; label: string | null };
  const [windows, setWindows] = useState<W[]>([]);
  const [dateWindows, setDateWindows] = useState<DW[]>([]);
  const [holidays, setHolidays] = useState<H[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) {
        setLoading(false);
        return;
      }
      const rangeStartKey = toDateInput(gridStart);
      const rangeEndKey = toDateInput(addDays(gridStart, 28));
      const [wRes, dwRes, hRes] = await Promise.all([
        sb
          .from("engineer_availability_windows")
          .select("weekday, start_minute, end_minute")
          .eq("engineer_user_id", me),
        sb
          .from("engineer_date_windows")
          .select("the_date")
          .eq("engineer_user_id", me)
          .gte("the_date", rangeStartKey)
          .lt("the_date", rangeEndKey),
        sb
          .from("engineer_holidays")
          .select("holiday_date, label")
          .eq("engineer_user_id", me)
          .gte("holiday_date", rangeStartKey)
          .lt("holiday_date", rangeEndKey),
      ]);
      if (!alive) return;
      if (!wRes.error)
        setWindows(
          (
            (wRes.data ?? []) as Array<{
              weekday: number;
              start_minute: number;
              end_minute: number;
            }>
          ).map((r) => ({
            weekday: r.weekday,
            startMinute: r.start_minute,
            endMinute: r.end_minute,
          }))
        );
      if (!dwRes.error)
        setDateWindows(
          ((dwRes.data ?? []) as Array<{ the_date: string }>).map((r) => ({
            date: r.the_date,
          }))
        );
      if (!hRes.error)
        setHolidays(
          (
            (hRes.data ?? []) as Array<{
              holiday_date: string;
              label: string | null;
            }>
          ).map((r) => ({
            date: r.holiday_date,
            label: r.label,
          }))
        );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gridStart]);

  // Per-day stats (window, holiday, booking count).
  const cells = useMemo(() => {
    return dates.map((d) => {
      const key = toDateInput(d);
      const hol = holidays.find((h) => h.date === key);
      const hasOverride = dateWindows.some((dw) => dw.date === key);
      const hasWindow =
        !hol && (hasOverride || windows.some((w) => w.weekday === d.getDay()));
      const dayBookings = bookings.filter((b) => {
        const bd = new Date(b.slotStart);
        bd.setHours(0, 0, 0, 0);
        return bd.getTime() === d.getTime();
      });
      return {
        date: d,
        key,
        isToday: d.getTime() === todayMid.getTime(),
        isPast: d.getTime() < todayMid.getTime(),
        isHoliday: !!hol,
        holidayLabel: hol?.label ?? null,
        hasWindow,
        bookings: dayBookings,
      };
    });
  }, [dates, windows, dateWindows, holidays, bookings, todayMid]);

  // Date range label, e.g. "May 24 – Jun 20".
  const rangeLabel = useMemo(() => {
    const start = gridStart;
    const end = addDays(gridStart, 27);
    const fmt = (d: Date) =>
      d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  }, [gridStart]);

  const selectedCell = selectedDateKey
    ? (cells.find((c) => c.key === selectedDateKey) ?? null)
    : null;

  return (
    <>
      <section
        // On lg the card is pinned to the same height as the Scheduled box and
        // lays out as a column so the date grid below grows to fill — keeping
        // both cards the same height.
        className="overflow-hidden rounded-xl border lg:flex lg:h-[460px] lg:flex-col"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <header
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 lg:shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <CalendarIcon size={13} style={{ color: BRAND_GREEN }} />
          <h2
            className="text-[13px] font-semibold"
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-source-serif)",
            }}
          >
            Next 4 weeks
          </h2>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            · {rangeLabel}
          </span>
        </header>

        {/* Weekday header */}
        <div
          className="grid grid-cols-7 border-b px-2 py-1.5 text-[9px] font-semibold tracking-wider uppercase lg:shrink-0"
          style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center">
              {d}
            </div>
          ))}
        </div>

        {loading ? (
          <div
            className="flex items-center justify-center gap-2 px-4 py-12 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div
            className="grid grid-cols-7 gap-px p-2 lg:min-h-0 lg:flex-1 lg:grid-rows-4"
            style={{ backgroundColor: "var(--border)" }}
          >
            {cells.map((c) => {
              // Color: holiday > availability > neutral.
              const bg = c.isHoliday
                ? "color-mix(in srgb, var(--accent-red) 18%, var(--surface))"
                : c.hasWindow
                  ? "color-mix(in srgb, var(--primary) 16%, var(--surface))"
                  : "var(--surface)";
              const borderColor = c.isToday ? BRAND_GREEN : "transparent";
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={c.isPast}
                  onClick={() => setSelectedDateKey(c.key)}
                  title={
                    c.isHoliday
                      ? `Off${c.holidayLabel ? ` · ${c.holidayLabel}` : ""}`
                      : c.hasWindow
                        ? `Available · ${c.bookings.length} booking${c.bookings.length === 1 ? "" : "s"}`
                        : "Off day"
                  }
                  className="flex min-h-[72px] flex-col items-stretch gap-1 rounded-md border-2 p-2 text-left transition-colors hover:brightness-110 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: bg,
                    borderColor,
                    opacity: c.isPast ? 0.32 : 1,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span
                      className="text-[13px] font-semibold tabular-nums"
                      style={{
                        color: c.isToday
                          ? BRAND_GREEN
                          : c.isHoliday
                            ? "var(--accent-red)"
                            : "var(--text)",
                        textDecoration: c.isHoliday ? "line-through" : "none",
                      }}
                    >
                      {c.date.getDate()}
                    </span>
                    {c.bookings.length > 0 && (
                      <span
                        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white tabular-nums"
                        style={{ backgroundColor: BRAND_GREEN }}
                      >
                        {c.bookings.length}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{
                      color: c.isHoliday
                        ? "var(--accent-red)"
                        : "var(--text-muted)",
                    }}
                  >
                    {c.isHoliday
                      ? (c.holidayLabel ?? "Off")
                      : c.hasWindow
                        ? "Available"
                        : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--primary) 16%, var(--surface))",
                border: "1px solid var(--border)",
              }}
            />
            available
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--accent-red) 18%, var(--surface))",
                border: "1px solid var(--border)",
              }}
            />
            holiday / off
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex h-3 min-w-3 items-center justify-center rounded-full px-1 text-[8px] font-semibold text-white tabular-nums"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              N
            </span>
            scheduled calls
          </span>
          <span className="ml-auto" style={{ color: "var(--text-faint)" }}>
            click any day to see calls
          </span>
        </div>
      </section>

      {selectedCell && (
        <DayDetailModal
          date={selectedCell.date}
          isHoliday={selectedCell.isHoliday}
          holidayLabel={selectedCell.holidayLabel}
          hasWindow={selectedCell.hasWindow}
          bookings={selectedCell.bookings}
          actionBusyId={actionBusyId}
          onCancel={onCancel}
          onClose={() => setSelectedDateKey(null)}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DayDetailModal — popup overlay shown when the engineer clicks a day
// cell in FourWeekCalendar. Lists that day's scheduled calls (full info
// — customer name, project, time slot, notes) and lets the engineer
// cancel any of them inline.
//
// Closes on backdrop click or the explicit X button. Esc-to-close is
// handled via the keydown listener so keyboard users aren't trapped.
// ──────────────────────────────────────────────────────────────────────────
function DayDetailModal({
  date,
  isHoliday,
  holidayLabel,
  hasWindow,
  bookings,
  actionBusyId,
  onCancel,
  onClose,
}: {
  date: Date;
  isHoliday: boolean;
  holidayLabel: string | null;
  hasWindow: boolean;
  bookings: IncomingBooking[];
  actionBusyId: string | null;
  onCancel: (b: IncomingBooking) => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dateLabel = date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-12"
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border shadow-xl"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: isHoliday
                ? "color-mix(in srgb, var(--accent-red) 14%, transparent)"
                : hasWindow
                  ? BRAND_GREEN_SOFT
                  : "color-mix(in srgb, var(--text) 6%, transparent)",
              color: isHoliday
                ? "var(--accent-red)"
                : hasWindow
                  ? BRAND_GREEN
                  : "var(--text-muted)",
            }}
          >
            <CalendarIcon size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="text-[15px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              {dateLabel}
            </h3>
            <p
              className="mt-0.5 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              {isHoliday
                ? `Off${holidayLabel ? ` · ${holidayLabel}` : ""}`
                : hasWindow
                  ? `Available · ${bookings.length} scheduled call${bookings.length === 1 ? "" : "s"}`
                  : "No availability window scheduled."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            aria-label="Close"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {bookings.length === 0 ? (
            <div
              className="px-5 py-8 text-center text-[13px]"
              style={{ color: "var(--text-faint)" }}
            >
              No scheduled calls.
            </div>
          ) : (
            <ul className="flex flex-col">
              {bookings
                .slice()
                .sort(
                  (a, b) =>
                    new Date(a.slotStart).getTime() -
                    new Date(b.slotStart).getTime()
                )
                .map((b) => (
                  <li
                    key={b.id}
                    className="border-t px-5 py-3 first:border-t-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <ModalBookingRow
                      booking={b}
                      busy={actionBusyId === b.id}
                      onCancel={() => void onCancel(b)}
                    />
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalBookingRow({
  booking,
  busy,
  onCancel,
}: {
  booking: IncomingBooking;
  busy: boolean;
  onCancel: () => void;
}) {
  const start = new Date(booking.slotStart);
  const end = new Date(booking.slotEnd);
  const name = booking.customerName ?? booking.customerEmail ?? "Customer";
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        aria-hidden
      >
        <CalendarIcon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className="text-[13px] font-semibold tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {start.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
            <span style={{ color: "var(--text-muted)" }}>
              {" → "}
              {end.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
        <div
          className="text-[13px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {name}
        </div>
        {booking.projectName && (
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {booking.projectName}
          </div>
        )}
        {booking.notes && (
          <p
            className="mt-1 text-[12px] italic"
            style={{ color: "var(--text-muted)" }}
          >
            &ldquo;{booking.notes}&rdquo;
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        title="Cancel this booking"
      >
        {busy ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <X size={10} />
        )}
        Cancel
      </button>
    </div>
  );
}

// Date helpers for FourWeekCalendar.
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// MonthStatsRow — bottom KPI strip.
// Five INDEPENDENT cards (each with its own border + background) rather
// than five segments of one big card. The "THIS MONTH" group header is
// gone — each tile already has a sub-label naming its own time period
// ("this month", "all time", "completed", etc.), so the group title was
// redundant and inaccurate (Customers served is all-time, not month).
// Layout flexes from 5-up on wide screens to 2-up on mobile.
// ──────────────────────────────────────────────────────────────────────────
function MonthStatsRow({ stats }: { stats: DashStats }) {
  const tiles: Array<{
    value: number;
    label: string;
    sub: string;
    accent: string;
  }> = [
    {
      value: stats.callsTaken,
      label: "Calls taken",
      sub: "this month",
      accent: BRAND_GREEN,
    },
    {
      value: stats.uniqueCustomers,
      label: "Customers served",
      sub: "all time",
      accent: "#0ea5e9",
    },
    {
      value: stats.goliveDone,
      label: "Go-lives done",
      sub: "completed",
      accent: "#16a34a",
    },
    {
      value: stats.goliveActive,
      label: "Go-lives active",
      sub: "in progress",
      accent: "#7c3aed",
    },
    {
      value: stats.maintaining,
      label: "Maintaining",
      sub: "active",
      accent: "#dc2626",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-1 rounded-xl border px-4 py-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          <span
            className="text-[26px] leading-none font-semibold tabular-nums"
            style={{ color: t.accent, fontFamily: "var(--font-source-serif)" }}
          >
            {t.value}
          </span>
          <span
            className="mt-1 text-[12px] font-medium"
            style={{ color: "var(--text)" }}
          >
            {t.label}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {t.sub}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── UI parts ───────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
