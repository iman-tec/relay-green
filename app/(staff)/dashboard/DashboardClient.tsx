"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { createClient } from "@/lib/supabase/browser";
import {
  Activity,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  LifeBuoy,
  TrendingUp,
  Loader2,
  PhoneIncoming,
  AlertTriangle,
  Wrench,
  X,
} from "lucide-react";

// ── Presence ────────────────────────────────────────────────────────────
// 3-state engineer presence (Available / Busy / Offline) elevated onto the
// dashboard. Realtime-synced with the top-right EngineerPresenceBadge.
// DB value is 'online' (legacy name) but we render the UI as "Available"
// since that's how engineers think about it.
type Presence = "online" | "busy" | "offline";
function isPresence(v: unknown): v is Presence {
  return v === "online" || v === "busy" || v === "offline";
}

// ── Contract task counts ─────────────────────────────────────────────────
// Counts of golive + maintain projects the engineer has worked on. Uses
// the new projects.contract_type column. Falls back to 0 silently if the
// migration hasn't applied yet (PostgREST returns 400 on missing column).
function useContractTaskCounts() {
  const [counts, setCounts] = useState({ golive: 0, maintain: 0 });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();
        const { data: u } = await sb.auth.getUser();
        const me = u.user?.id;
        if (!alive || !me) return;
        const { data, error } = await sb
          .from("guest_calls")
          .select("project_id, projects!inner(contract_type, completion_status)")
          .eq("claimed_by", me)
          .not("project_id", "is", null);
        if (!alive) return;
        if (error) {
          // Column may not exist yet (migration pending). Silent fail.
          return;
        }
        // PostgREST's foreign-table embed can return either an array or
        // a single object depending on the relationship's cardinality.
        // For guest_calls → projects this is many-to-one, but the typed
        // client doesn't know that, so we accept both shapes.
        type Embed = { contract_type: string | null; completion_status: string | null };
        type Row = {
          project_id: string;
          projects: Embed | Embed[] | null;
        };
        const seen = { golive: new Set<string>(), maintain: new Set<string>() };
        for (const r of (data ?? []) as unknown as Row[]) {
          const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
          const ct = p?.contract_type;
          const cs = p?.completion_status;
          if (ct === "golive" && r.project_id) seen.golive.add(r.project_id);
          if (ct === "maintain" && cs === "active" && r.project_id) seen.maintain.add(r.project_id);
        }
        setCounts({ golive: seen.golive.size, maintain: seen.maintain.size });
      } catch { /* silent */ }
    })();
    return () => { alive = false; };
  }, []);
  return counts;
}

// Small wrapper around the legacy 4-stat-card visual so the new stats
// don't need bespoke JSX.
function StatBlock({
  label, value, icon: Icon, accent, bg,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  accent: string;
  bg: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: bg, color: accent }}
      >
        <Icon size={18} />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--text)" }}>
          {value}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ── Today + this-week calendar peek ─────────────────────────────────────
// Compact dashboard widget that answers "what's my day look like?" without
// the engineer opening the Calendar tab. Three rows:
//   1. Today header — date + window status (in window / off-hours / holiday)
//   2. Today's bookings (if any)
//   3. Mini 7-day strip — booking-count dots + window indicator per day
//
// Resolution mirrors the customer ScheduleModal + monthly view:
//   holiday → date_windows → weekly_pattern.
function CalendarPeek() {
  const sbRef = useRef(createClient());
  const [loading, setLoading] = useState(true);
  type W = { weekday: number; startMinute: number; endMinute: number };
  type DW = { date: string; startMinute: number; endMinute: number };
  type Bk = { id: string; slotStart: string; slotEnd: string };
  type H = { date: string; label: string | null };
  const [windows, setWindows] = useState<W[]>([]);
  const [dateWindows, setDateWindows] = useState<DW[]>([]);
  const [bookings, setBookings] = useState<Bk[]>([]);
  const [holidays, setHolidays] = useState<H[]>([]);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;

      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 8);

      const [wRes, dwRes, bRes, hRes] = await Promise.all([
        sb.from("engineer_availability_windows")
          .select("weekday, start_minute, end_minute")
          .eq("engineer_user_id", me),
        sb.from("engineer_date_windows")
          .select("the_date, start_minute, end_minute")
          .eq("engineer_user_id", me)
          .gte("the_date", from.toISOString().slice(0, 10))
          .lt("the_date", to.toISOString().slice(0, 10)),
        sb.from("engineer_bookings")
          .select("id, slot_start, slot_end, status")
          .eq("engineer_user_id", me)
          .eq("status", "booked")
          .gte("slot_start", from.toISOString())
          .lt("slot_start", to.toISOString()),
        sb.from("engineer_holidays")
          .select("holiday_date, label")
          .eq("engineer_user_id", me)
          .gte("holiday_date", from.toISOString().slice(0, 10))
          .lt("holiday_date", to.toISOString().slice(0, 10)),
      ]);
      if (!alive) return;
      if (!wRes.error) {
        setWindows(((wRes.data ?? []) as Array<{ weekday: number; start_minute: number; end_minute: number }>).map((r) => ({
          weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute,
        })));
      }
      if (!dwRes.error) {
        setDateWindows(((dwRes.data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>).map((r) => ({
          date: r.the_date, startMinute: r.start_minute, endMinute: r.end_minute,
        })));
      }
      if (!bRes.error) {
        setBookings(((bRes.data ?? []) as Array<{ id: string; slot_start: string; slot_end: string }>).map((r) => ({
          id: r.id, slotStart: r.slot_start, slotEnd: r.slot_end,
        })));
      }
      if (!hRes.error) {
        setHolidays(((hRes.data ?? []) as Array<{ holiday_date: string; label: string | null }>).map((r) => ({
          date: r.holiday_date, label: r.label,
        })));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const dayKeyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayKey = dayKeyOf(today);
  const todayHoliday = holidays.find((h) => h.date === todayKey);
  const todayOverrides = dateWindows.filter((dw) => dw.date === todayKey);
  const todayWindows = todayOverrides.length > 0
    ? todayOverrides
    : windows.filter((w) => w.weekday === today.getDay());
  const todayBookings = bookings.filter((b) => {
    const d = new Date(b.slotStart); d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  });

  // Are we currently inside any of today's windows?
  const nowMinutes = (() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  })();
  const inWindowNow = !todayHoliday && todayWindows.some(
    (w) => nowMinutes >= w.startMinute && nowMinutes < w.endMinute,
  );

  // 7-day strip (today + 6 ahead). Each entry summarises availability
  // and shows a booking-count dot.
  const weekDays = useMemo(() => {
    const out: Array<{ date: Date; key: string; weekdayLabel: string; dayNum: number; hasWindow: boolean; isHoliday: boolean; bookingCount: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const k = dayKeyOf(d);
      const hol = holidays.some((h) => h.date === k);
      const overrides = dateWindows.filter((dw) => dw.date === k);
      const dayW = overrides.length > 0 ? overrides : windows.filter((w) => w.weekday === d.getDay());
      const bks = bookings.filter((b) => {
        const bd = new Date(b.slotStart); bd.setHours(0, 0, 0, 0);
        return bd.getTime() === d.getTime();
      });
      out.push({
        date: d,
        key: k,
        weekdayLabel: d.toLocaleDateString([], { weekday: "short" }),
        dayNum: d.getDate(),
        hasWindow: !hol && dayW.length > 0,
        isHoliday: hol,
        bookingCount: bks.length,
      });
    }
    return out;
  }, [today, windows, dateWindows, bookings, holidays]);

  if (loading) {
    return (
      <Section title="This week" subtitle="Your availability + booked slots ahead.">
        <div className="flex items-center gap-2 px-5 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={14} className="animate-spin" /> Loading calendar…
        </div>
      </Section>
    );
  }

  return (
    <Section title="This week" subtitle="Your availability + bookings for the next 7 days.">
      {/* Today summary */}
      <div className="border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <CalendarIcon size={14} style={{ color: inWindowNow ? BRAND_GREEN : "var(--text-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Today · {today.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
          </span>
          {todayHoliday ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: "color-mix(in srgb, var(--accent-red) 14%, transparent)", color: "var(--accent-red)" }}
            >
              Off{todayHoliday.label ? ` · ${todayHoliday.label}` : ""}
            </span>
          ) : inWindowNow ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              In window
            </span>
          ) : todayWindows.length > 0 ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
            >
              Off-hours
            </span>
          ) : (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)", color: "var(--text-muted)" }}
            >
              No windows
            </span>
          )}
        </div>
        {!todayHoliday && todayWindows.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {todayWindows.sort((a, b) => a.startMinute - b.startMinute).map((w, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
                  color: BRAND_GREEN,
                }}
              >
                {fmt12hLocal(w.startMinute)} → {fmt12hLocal(w.endMinute)}
              </span>
            ))}
          </div>
        )}
        {todayBookings.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Booked today
            </span>
            {todayBookings.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1 text-[12px]"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
                <span className="tabular-nums">
                  {new Date(b.slotStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {" → "}
                  {new Date(b.slotEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7-day strip */}
      <div className="border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Next 7 days
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((d, i) => (
            <div
              key={d.key}
              className="flex flex-col items-center gap-1 rounded-lg border p-2"
              style={{
                borderColor: i === 0 ? "var(--primary)" : "var(--border)",
                backgroundColor: i === 0
                  ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                  : d.isHoliday
                    ? "color-mix(in srgb, var(--accent-red) 4%, transparent)"
                    : d.hasWindow
                      ? "var(--surface)"
                      : "color-mix(in srgb, var(--text) 3%, transparent)",
              }}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {d.weekdayLabel}
              </span>
              <span
                className="text-[14px] font-semibold tabular-nums"
                style={{
                  color: i === 0 ? "var(--primary)" : "var(--text)",
                  textDecoration: d.isHoliday ? "line-through" : "none",
                }}
              >
                {d.dayNum}
              </span>
              <div className="flex h-3 items-center gap-0.5">
                {d.bookingCount > 0 ? (
                  <>
                    {Array.from({ length: Math.min(d.bookingCount, 3) }).map((_, k) => (
                      <span key={k} className="size-1.5 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
                    ))}
                    {d.bookingCount > 3 && (
                      <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>+{d.bookingCount - 3}</span>
                    )}
                  </>
                ) : d.hasWindow ? (
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function fmt12hLocal(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 < 12 ? "am" : "pm";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

// ── Supervisor contact (emergency) ──────────────────────────────────────
// Placeholder until the real chat / Zoom-with-supervisor flow lands.
// Surfaces the support email + a "Coming soon" notice for the chat path.
function SupervisorContactCard() {
  const [open, setOpen] = useState(false);
  const closeContact = useCallback(() => setOpen(false), []);
  const dialogRef = useOverlayDismiss<HTMLDivElement>(closeContact, open);
  return (
    <>
      <div
        className="rounded-xl border p-4"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--warn) 4%, var(--surface))",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
          >
            <LifeBuoy size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Need to escalate?
            </h3>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Mid-call emergency, customer issue you can&apos;t resolve, or just need a second pair of eyes — ping your supervisor.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: URGENT_AMBER }}
            >
              <LifeBuoy size={12} />
              Contact supervisor
            </button>
          </div>
        </div>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-6"
          style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(4px)" }}
        >
          <div
            ref={dialogRef}
            className="relative w-full max-w-md rounded-2xl border p-6 shadow-xl"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <h3 className="mb-2 text-base font-semibold" style={{ color: "var(--text)" }}>
              Contact your supervisor
            </h3>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              In-app chat + 1-click Zoom with your assigned supervisor is coming in a follow-up. For now:
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 text-[13px]" style={{ color: "var(--text)" }}>
              <li>📧 Email <a href="mailto:ops@relay.green" className="underline" style={{ color: "var(--primary)" }}>ops@relay.green</a> for non-urgent matters</li>
              <li>📱 Use your usual emergency Slack/WhatsApp channel for live incidents</li>
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
import type { GuestCall } from "@/lib/supabase/types";

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
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED = "#8b1a1a";
const CRIT_RED_SOFT = "rgba(139, 26, 26, 0.18)";

export function DashboardClient() {
  const router = useRouter();
  useRequireEngineerProfile();
  const { myActive, queue, recent, loading, error, takeNext, claim } = useEngineerWorkspace();

  // ── Incoming-for-you: pending connect requests + upcoming bookings ──
  // Surfaced ABOVE the existing queue because a customer who specifically
  // chose YOU (request or scheduled slot) outranks the anonymous queue.
  // Both lists realtime-sync so the engineer doesn't need to refresh.
  const sbRef = useRef(createClient());
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [incomingBookings, setIncomingBookings] = useState<IncomingBooking[]>([]);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Lookup helpers used to enrich the raw rows with customer / project
  // names. Pulled inline rather than via foreign-key embed because the
  // existing schema doesn't have an FK that PostgREST resolves to
  // customer_profiles cleanly.
  const enrichRequest = useCallback(async (row: {
    id: string;
    customer_user_id: string;
    project_id: string | null;
    message: string | null;
    created_at: string;
  }): Promise<IncomingRequest> => {
    const sb = sbRef.current;
    const [custRes, projRes] = await Promise.all([
      sb.from("customer_profiles")
        .select("display_name, email")
        .eq("user_id", row.customer_user_id)
        .maybeSingle(),
      row.project_id
        ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
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
  }, []);

  const enrichBooking = useCallback(async (row: {
    id: string;
    slot_start: string;
    slot_end: string;
    customer_user_id: string;
    project_id: string | null;
    notes: string | null;
  }): Promise<IncomingBooking> => {
    const sb = sbRef.current;
    const [custRes, projRes] = await Promise.all([
      sb.from("customer_profiles")
        .select("display_name, email")
        .eq("user_id", row.customer_user_id)
        .maybeSingle(),
      row.project_id
        ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
    const proj = (projRes.data ?? null) as { name: string | null } | null;
    return {
      id: row.id,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
      customerUserId: row.customer_user_id,
      projectId: row.project_id,
      notes: row.notes,
      customerName: cust?.display_name ?? null,
      customerEmail: cust?.email ?? null,
      projectName: proj?.name ?? null,
    };
  }, []);

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
        id: string; customer_user_id: string; project_id: string | null;
        message: string | null; created_at: string;
      }>;
      const bkRows = (bkRes.data ?? []) as Array<{
        id: string; slot_start: string; slot_end: string;
        customer_user_id: string; project_id: string | null; notes: string | null;
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
      const suffix = typeof crypto !== "undefined" && crypto.randomUUID
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
            const next = payload.new as (typeof reqRows[number] & { status?: string }) | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingRequests((prev) => prev.filter((r) => r.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "pending") {
              setIncomingRequests((prev) => prev.filter((r) => r.id !== next.id));
              return;
            }
            void enrichRequest(next).then((enriched) => {
              if (!alive) return;
              setIncomingRequests((prev) => {
                const without = prev.filter((r) => r.id !== enriched.id);
                return [enriched, ...without].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
              });
            });
          },
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
            const next = payload.new as (typeof bkRows[number] & { status?: string }) | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "booked") {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== next.id));
              return;
            }
            // Past slots fall out of the list.
            if (new Date(next.slot_end).getTime() < Date.now() - 15 * 60_000) {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== next.id));
              return;
            }
            void enrichBooking(next).then((enriched) => {
              if (!alive) return;
              setIncomingBookings((prev) => {
                const without = prev.filter((b) => b.id !== enriched.id);
                return [...without, enriched].sort(
                  (a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
                );
              });
            });
          },
        )
        .subscribe();
    })();

    return () => {
      alive = false;
      if (reqCh) sb.removeChannel(reqCh);
      if (bkCh) sb.removeChannel(bkCh);
    };
  }, [enrichRequest, enrichBooking]);

  const onAcceptRequest = useCallback(async (req: IncomingRequest) => {
    if (actionBusyId) return;
    setActionBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("accept_connect_request", { _id: req.id });
      if (rpcErr) {
        window.alert(`Couldn't accept: ${rpcErr.message}`);
        return;
      }
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId]);

  const onDeclineRequest = useCallback(async (req: IncomingRequest) => {
    if (actionBusyId) return;
    setActionBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("decline_connect_request", { _id: req.id });
      if (rpcErr) {
        window.alert(`Couldn't decline: ${rpcErr.message}`);
        return;
      }
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId]);

  const onCancelBooking = useCallback(async (b: IncomingBooking) => {
    if (actionBusyId) return;
    if (typeof window !== "undefined" && !window.confirm("Cancel this booking? The customer will be notified.")) return;
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
  }, [actionBusyId]);

  const hasIncoming = incomingRequests.length > 0 || incomingBookings.length > 0;

  const liveCount = myActive.filter((s) => s.status === "live").length;

  // Stats now reflect the engineer's three work phases — build (minutes),
  // golive (project count), maintain (project count). The data behind
  // golive + maintain comes from the new ContractTaskCounts hook which
  // queries the contract_type column (falls back to 0 until the
  // 20260527180000_project_contract_type migration is applied).
  const buildMinutesThisMonth = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let sum = 0;
    for (const s of recent) {
      if (s.status !== "ended" || !s.duration_minutes) continue;
      if (new Date(s.created_at) < monthStart) continue;
      sum += Number(s.duration_minutes);
    }
    return sum;
  }, [recent]);
  const contractCounts = useContractTaskCounts();

  const handleTakeNext = async () => {
    const claimed = await takeNext();
    if (claimed) router.push(`/staff/session/${claimed.id}`);
  };

  // Per-row claim — clicking a specific QueueRow takes THAT customer,
  // not the head of the queue. Triage page used to handle this; now we
  // do it inline since /triage has been removed.
  const handleClaim = async (sessionId: string) => {
    const claimed = await claim(sessionId);
    if (claimed) router.push(`/staff/session/${claimed.id}`);
  };

  // Imminent bookings (next 90 minutes) — promoted from the broader
  // upcoming list into the "Now" urgency band so the engineer sees them
  // alongside the queue and pending requests.
  const imminentBookings = useMemo(() => {
    const now = Date.now();
    const horizon = now + 90 * 60_000;
    return incomingBookings.filter((b) => {
      const start = new Date(b.slotStart).getTime();
      return start <= horizon && new Date(b.slotEnd).getTime() > now - 15 * 60_000;
    });
  }, [incomingBookings]);

  const laterBookings = useMemo(() => {
    return incomingBookings.filter((b) => !imminentBookings.includes(b));
  }, [incomingBookings, imminentBookings]);

  const hasNowItems = queue.length > 0 || incomingRequests.length > 0 || imminentBookings.length > 0;

  return (
    <div className="mx-auto max-w-screen-xl space-y-5 px-6 py-6">
      {/* ── Compact greeting header — presence + Take-next inline.
          Replaces the prior "My Dashboard / Your sessions and clients"
          marketing copy plus the separate 3-card presence picker. */}
      <DashboardHeader
        queueCount={queue.length}
        onTakeNext={handleTakeNext}
      />

      {error && (
        <div
          className="rounded-md border px-4 py-2.5 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Pending callbacks — customers who tried to reach the engineer
          while they were Busy and asked to be called back. Sits at the
          top of the dashboard so the engineer always sees who's waiting.
          The same realtime subscription that powers NowSection drives
          this card; rows disappear automatically when the request is
          accepted, declined, or expires. The EngineerPresenceBall reads
          this same table to drive the "30s after going online" auto-ring. */}
      {incomingRequests.length > 0 && (
        <PendingCallbacksCard
          requests={incomingRequests}
          actionBusyId={actionBusyId}
          onAccept={onAcceptRequest}
          onDecline={onDeclineRequest}
        />
      )}

      {/* ── "Now" — urgent actionable items.
          Renders only when there's something to do. Combines the queue,
          pending requests, and bookings starting in the next 90 minutes.
          The user explicitly said an empty "0 Live now / 0 Completed"
          stats bank felt dead, so we hide this block entirely when empty
          rather than showing "Nothing to do right now." */}
      {hasNowItems && (
        <NowSection
          queue={queue}
          requests={incomingRequests}
          imminent={imminentBookings}
          actionBusyId={actionBusyId}
          onClaim={handleClaim}
          onAcceptRequest={onAcceptRequest}
          onDeclineRequest={onDeclineRequest}
          onCancelBooking={onCancelBooking}
        />
      )}

      {/* ── Today — explicit list of bookings + window status. */}
      <TodayBlock />

      {/* ── Compressed stats + week strip — side-by-side on wide screens. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CompactStatsStrip
          buildMinutes={buildMinutesThisMonth}
          liveCount={liveCount}
          golive={contractCounts.golive}
          maintain={contractCounts.maintain}
        />
        <WeekStrip />
      </div>

      {/* ── Active now — only renders when the engineer has claimed sessions. */}
      {myActive.length > 0 && (
        <Section
          title={`Active now (${myActive.length})`}
          subtitle="Sessions you've claimed. Click to enter the session room."
        >
          {myActive.map((s) => (
            <ActiveRow key={s.id} session={s} onOpen={() => router.push(`/staff/session/${s.id}`)} />
          ))}
        </Section>
      )}

      {/* ── Later bookings — anything that didn't make the "Now" cutoff. */}
      {laterBookings.length > 0 && (
        <Section
          title={`Scheduled (${laterBookings.length})`}
          subtitle="Customer-booked slots beyond the next 90 minutes."
        >
          {laterBookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              busy={actionBusyId === b.id}
              onCancel={() => void onCancelBooking(b)}
            />
          ))}
        </Section>
      )}

      {/* Loading shell only on first paint, when nothing else is rendered. */}
      {loading && myActive.length === 0 && !hasNowItems && (
        <div className="flex justify-center py-6">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      )}

      {/* Footer — supervisor escalation demoted from a card to a quiet
          link, since it's a rarely-used emergency action. */}
      <DashboardFooterEscalate />
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
  queueCount, onTakeNext,
}: {
  queueCount: number;
  onTakeNext: () => void;
}) {
  const sbRef = useRef(createClient());
  const [name, setName] = useState<string>("");
  const [presence, setPresence] = useState<Presence | null>(null);

  // Greeting source: profiles.full_name → first word; falls back to email
  // local-part. Loaded lazily; renders "engineer" until it arrives.
  //
  // Channel-leak fix: the previous version returned a cleanup function
  // from the async IIFE — which useEffect cannot see, so the channel
  // hung around after unmount. On the next visit (or another component
  // sharing the same channel name) Supabase's realtime client
  // deduplicates by name and throws "cannot add postgres_changes after
  // subscribe()". Two-part fix:
  //   1. Hold the channel in a ref so the useEffect cleanup can actually
  //      remove it.
  //   2. Suffix the channel name with a per-mount UUID so even a stale
  //      leaked channel can't collide with a fresh one.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
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
      const first = full ? full.trim().split(/\s+/)[0] : (me.email ?? "").split("@")[0];
      setName(first || "engineer");
      // Presence — load + realtime subscribe.
      const { data: pres } = await sb
        .from("engineer_profiles")
        .select("presence_state, is_available")
        .eq("user_id", me.id)
        .maybeSingle();
      if (!alive) return;
      const row = (pres ?? null) as { presence_state: string | null; is_available: boolean | null } | null;
      if (row) {
        if (isPresence(row.presence_state)) setPresence(row.presence_state);
        else setPresence(row.is_available ? "online" : "offline");
      }
      const suffix = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      ch = sb
        .channel(`dash-header-presence-${me.id}-${suffix}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "engineer_profiles", filter: `user_id=eq.${me.id}` },
          (payload) => {
            const next = payload.new as { presence_state?: string | null; is_available?: boolean | null } | null;
            if (!next) return;
            if (isPresence(next.presence_state)) setPresence(next.presence_state);
            else if (typeof next.is_available === "boolean") setPresence(next.is_available ? "online" : "offline");
          },
        )
        .subscribe();
    })();
    return () => {
      alive = false;
      if (ch) sb.removeChannel(ch);
    };
  }, []);

  const setPresenceRpc = useCallback(async (next: Presence) => {
    const previous = presence;
    if (previous === next) return;
    setPresence(next);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_presence", { _state: next });
      if (error) {
        setPresence(previous);
        console.warn("[presence] set failed:", error.message);
      }
    } catch (e) {
      setPresence(previous);
      console.warn("[presence] set threw:", e);
    }
  }, [presence]);

  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1
          className="text-[20px] font-semibold leading-tight"
          style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
        >
          Hi {name ? capitalize(name) : "there"}
        </h1>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {dateLabel}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Presence pill removed — single source of truth is now the
            sidebar ball (EngineerPresenceBall in StaffShell), which
            doubles as the ringing indicator when an incoming call lands. */}
        {queueCount > 0 && (
          <button
            onClick={onTakeNext}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <PhoneIncoming size={13} />
            Take next call · {queueCount}
          </button>
        )}
      </div>
    </header>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Compact dropdown picker — sits inline in the header. Single button
// shows current state (dot + label); click opens the 3-option menu.
function InlinePresencePicker({
  presence, onSet,
}: {
  presence: Presence | null;
  onSet: (next: Presence) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const meta: Record<Presence, { label: string; color: string }> = {
    online:  { label: "Available", color: BRAND_GREEN },
    busy:    { label: "Busy",      color: URGENT_AMBER },
    offline: { label: "Offline",   color: "#94a3b8" },
  };
  const current = presence ? meta[presence] : { label: "Loading…", color: "#94a3b8" };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={presence === null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        <span className="relative flex h-2 w-2">
          {presence === "online" && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full opacity-70"
              style={{
                backgroundColor: current.color,
                animation: "ping 1.6s cubic-bezier(0,0,0.2,1) infinite",
              }}
            />
          )}
          <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: current.color }} />
        </span>
        <span>{current.label}</span>
        <ChevronDown
          size={12}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms ease",
          }}
        />
      </button>
      {open && presence && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border shadow-xl"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
          }}
        >
          {(["online", "busy", "offline"] as const).map((v) => {
            const m = meta[v];
            const isActive = presence === v;
            const blurb = v === "online"
              ? "Matcher rings me — instant call"
              : v === "busy"
                ? "Matcher skips me — customer can request"
                : "Matcher skips me — customer schedules ahead";
            return (
              <button
                key={v}
                type="button"
                role="menuitem"
                onClick={() => { onSet(v); setOpen(false); }}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                      {m.label}
                    </span>
                    {isActive && <Check size={11} style={{ color: m.color }} />}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {blurb}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// NowSection — urgent actionable items aggregated into one block.
// Combines the customer queue, pending engineer-specific requests, and
// bookings starting in the next 90 minutes. Only renders when there's
// at least one item; the dashboard explicitly avoids a "Nothing here"
// empty-state because the dashboard already has plenty of structure
// around it.
// ──────────────────────────────────────────────────────────────────────────
function NowSection({
  queue, requests, imminent, actionBusyId,
  onClaim, onAcceptRequest, onDeclineRequest, onCancelBooking,
}: {
  queue: GuestCall[];
  requests: IncomingRequest[];
  imminent: IncomingBooking[];
  actionBusyId: string | null;
  onClaim: (id: string) => Promise<void>;
  onAcceptRequest: (r: IncomingRequest) => Promise<void>;
  onDeclineRequest: (r: IncomingRequest) => Promise<void>;
  onCancelBooking: (b: IncomingBooking) => Promise<void>;
}) {
  const total = queue.length + requests.length + imminent.length;
  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--primary) 4%, var(--surface))",
        boxShadow: "0 1px 3px 0 color-mix(in srgb, var(--primary) 10%, transparent)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-5 py-2.5"
        style={{ borderColor: "color-mix(in srgb, var(--primary) 20%, transparent)" }}
      >
        <PhoneIncoming size={14} style={{ color: BRAND_GREEN }} />
        <h2
          className="flex-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: BRAND_GREEN }}
        >
          Now · {total} item{total === 1 ? "" : "s"} need your attention
        </h2>
      </div>
      <div>
        {/* Pending engineer-specific requests come first — a customer
            explicitly asked for YOU vs. the anonymous queue. */}
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            busy={actionBusyId === r.id}
            onAccept={() => void onAcceptRequest(r)}
            onDecline={() => void onDeclineRequest(r)}
          />
        ))}
        {/* Imminent bookings — engineer should be ready to join. */}
        {imminent.map((b) => (
          <BookingRow
            key={b.id}
            booking={b}
            busy={actionBusyId === b.id}
            onCancel={() => void onCancelBooking(b)}
          />
        ))}
        {/* Anonymous queue, capped to 5 most urgent so the section
            doesn't grow unbounded during a flood. */}
        {queue.slice(0, 5).map((s) => (
          <QueueRow key={s.id} session={s} onTake={() => void onClaim(s.id)} />
        ))}
        {queue.length > 5 && (
          <div
            className="border-t px-5 py-2 text-[11px]"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            +{queue.length - 5} more in queue — hit Take next call to claim.
          </div>
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CompactStatsStrip — single horizontal card showing the three numbers
// the engineer cares about (Build / Go-live / Maintain) plus Live now,
// without the 4 separate stat-card chrome of the prior version.
// ──────────────────────────────────────────────────────────────────────────
function CompactStatsStrip({
  buildMinutes, liveCount, golive, maintain,
}: {
  buildMinutes: number;
  liveCount: number;
  golive: number;
  maintain: number;
}) {
  return (
    <div
      className="flex flex-wrap items-stretch gap-4 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <StatMicro label="Build minutes" sub="this month" value={`${Math.round(buildMinutes)} min`} accent={BRAND_GREEN} />
      <StatDivider />
      <StatMicro label="Live now" sub={liveCount > 0 ? "in session" : "no calls"} value={String(liveCount)} accent={liveCount > 0 ? "#0284c7" : "var(--text-muted)"} />
      <StatDivider />
      <StatMicro label="Go-live" sub="tasks" value={String(golive)} accent="#7c3aed" />
      <StatDivider />
      <StatMicro label="Maintain" sub="active" value={String(maintain)} accent="#dc2626" />
    </div>
  );
}

function StatMicro({
  label, sub, value, accent,
}: {
  label: string;
  sub: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label} <span className="opacity-60">· {sub}</span>
      </div>
      <div
        className="mt-1 text-[18px] font-semibold leading-tight tabular-nums"
        style={{ color: accent, fontFamily: "var(--font-source-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}

function StatDivider() {
  return (
    <span
      aria-hidden
      className="hidden self-stretch sm:inline-block"
      style={{ width: 1, backgroundColor: "var(--border)" }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// TodayBlock — extracted from the prior CalendarPeek. Shows just today's
// availability window status, booked slots, and the date header. The
// 7-day strip lives in its own WeekStrip component next to the stats.
// ──────────────────────────────────────────────────────────────────────────
function TodayBlock() {
  const sbRef = useRef(createClient());
  const [loading, setLoading] = useState(true);
  type W = { weekday: number; startMinute: number; endMinute: number };
  type DW = { date: string; startMinute: number; endMinute: number };
  type Bk = {
    id: string;
    slotStart: string;
    slotEnd: string;
    customerName: string | null;
    customerEmail: string | null;
    projectName: string | null;
  };
  type H = { date: string; label: string | null };
  const [windows, setWindows] = useState<W[]>([]);
  const [dateWindows, setDateWindows] = useState<DW[]>([]);
  const [bookings, setBookings] = useState<Bk[]>([]);
  const [holidays, setHolidays] = useState<H[]>([]);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      const [wRes, dwRes, bRes, hRes] = await Promise.all([
        sb.from("engineer_availability_windows")
          .select("weekday, start_minute, end_minute")
          .eq("engineer_user_id", me),
        sb.from("engineer_date_windows")
          .select("the_date, start_minute, end_minute")
          .eq("engineer_user_id", me)
          .eq("the_date", from.toISOString().slice(0, 10)),
        sb.from("engineer_bookings")
          .select("id, slot_start, slot_end, status, customer_user_id, project_id")
          .eq("engineer_user_id", me)
          .eq("status", "booked")
          .gte("slot_start", from.toISOString())
          .lt("slot_start", to.toISOString()),
        sb.from("engineer_holidays")
          .select("holiday_date, label")
          .eq("engineer_user_id", me)
          .eq("holiday_date", from.toISOString().slice(0, 10)),
      ]);
      if (!alive) return;
      if (!wRes.error) setWindows(((wRes.data ?? []) as Array<{ weekday: number; start_minute: number; end_minute: number }>).map((r) => ({
        weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute,
      })));
      if (!dwRes.error) setDateWindows(((dwRes.data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>).map((r) => ({
        date: r.the_date, startMinute: r.start_minute, endMinute: r.end_minute,
      })));
      // Enrich bookings with customer + project names so the row reads as
      // "9:30am · Pranay · mywebsite.com" instead of a bare time range.
      // Inline N+1 lookups are fine here — TodayBlock is bounded to a
      // single calendar day, so the worst case is a small list (rarely
      // more than ~10 bookings).
      if (!bRes.error) {
        const rawBks = (bRes.data ?? []) as Array<{
          id: string;
          slot_start: string;
          slot_end: string;
          customer_user_id: string;
          project_id: string | null;
        }>;
        const enriched = await Promise.all(
          rawBks.map(async (b) => {
            const [custRes, projRes] = await Promise.all([
              sb.from("customer_profiles").select("display_name, email").eq("user_id", b.customer_user_id).maybeSingle(),
              b.project_id ? sb.from("projects").select("name").eq("id", b.project_id).maybeSingle() : Promise.resolve({ data: null }),
            ]);
            const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
            const proj = (projRes.data ?? null) as { name: string | null } | null;
            return {
              id: b.id,
              slotStart: b.slot_start,
              slotEnd: b.slot_end,
              customerName: cust?.display_name ?? null,
              customerEmail: cust?.email ?? null,
              projectName: proj?.name ?? null,
            };
          }),
        );
        if (alive) setBookings(enriched);
      } else {
        // Query failed (likely transient or missing column) — bail to
        // an empty list rather than rendering stale data.
        if (alive) setBookings([]);
      }
      if (!hRes.error) setHolidays(((hRes.data ?? []) as Array<{ holiday_date: string; label: string | null }>).map((r) => ({
        date: r.holiday_date, label: r.label,
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayHoliday = holidays[0];
  const todayWindows = dateWindows.length > 0 ? dateWindows : windows.filter((w) => w.weekday === today.getDay());

  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const inWindowNow = !todayHoliday && todayWindows.some((w) => nowMinutes >= w.startMinute && nowMinutes < w.endMinute);

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarIcon size={14} style={{ color: inWindowNow ? BRAND_GREEN : "var(--text-muted)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Today
        </h2>
        {todayHoliday ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: "color-mix(in srgb, var(--accent-red) 14%, transparent)", color: "var(--accent-red)" }}
          >
            Off{todayHoliday.label ? ` · ${todayHoliday.label}` : ""}
          </span>
        ) : inWindowNow ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          >
            In window
          </span>
        ) : todayWindows.length > 0 ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
          >
            Off-hours
          </span>
        ) : (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)", color: "var(--text-muted)" }}
          >
            No windows
          </span>
        )}
        <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
          {bookings.length} booking{bookings.length === 1 ? "" : "s"}
        </span>
      </header>
      {loading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {!todayHoliday && todayWindows.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {todayWindows.sort((a, b) => a.startMinute - b.startMinute).map((w, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                  style={{
                    borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
                    color: BRAND_GREEN,
                  }}
                >
                  {fmt12hLocal(w.startMinute)} → {fmt12hLocal(w.endMinute)}
                </span>
              ))}
            </div>
          )}
          {bookings.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
              No customer bookings today.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bookings
                .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime())
                .map((b) => {
                  const name = b.customerName ?? b.customerEmail ?? "Customer";
                  return (
                    <div
                      key={b.id}
                      className="flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-[12px]"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: "#0ea5e9" }}
                      />
                      <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {new Date(b.slotStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        {" → "}
                        {new Date(b.slotEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="truncate font-medium" style={{ color: "var(--text)" }}>
                        {name}
                      </span>
                      {b.projectName && (
                        <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                          · {b.projectName}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// WeekStrip — compact 7-day row. Replaces the prior 7-card layout that
// took too much vertical room.
// ──────────────────────────────────────────────────────────────────────────
function WeekStrip() {
  const sbRef = useRef(createClient());
  const [loading, setLoading] = useState(true);
  type W = { weekday: number; startMinute: number; endMinute: number };
  type Bk = { slotStart: string };
  type DW = { date: string };
  type H = { date: string };
  const [windows, setWindows] = useState<W[]>([]);
  const [bookings, setBookings] = useState<Bk[]>([]);
  const [dateWindows, setDateWindows] = useState<DW[]>([]);
  const [holidays, setHolidays] = useState<H[]>([]);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 8);
      const [wRes, dwRes, bRes, hRes] = await Promise.all([
        sb.from("engineer_availability_windows").select("weekday, start_minute, end_minute").eq("engineer_user_id", me),
        sb.from("engineer_date_windows").select("the_date").eq("engineer_user_id", me)
          .gte("the_date", from.toISOString().slice(0, 10)).lt("the_date", to.toISOString().slice(0, 10)),
        sb.from("engineer_bookings").select("slot_start, status").eq("engineer_user_id", me).eq("status", "booked")
          .gte("slot_start", from.toISOString()).lt("slot_start", to.toISOString()),
        sb.from("engineer_holidays").select("holiday_date").eq("engineer_user_id", me)
          .gte("holiday_date", from.toISOString().slice(0, 10)).lt("holiday_date", to.toISOString().slice(0, 10)),
      ]);
      if (!alive) return;
      if (!wRes.error) setWindows(((wRes.data ?? []) as Array<{ weekday: number; start_minute: number; end_minute: number }>).map((r) => ({
        weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute,
      })));
      if (!dwRes.error) setDateWindows(((dwRes.data ?? []) as Array<{ the_date: string }>).map((r) => ({ date: r.the_date })));
      if (!bRes.error) setBookings(((bRes.data ?? []) as Array<{ slot_start: string }>).map((r) => ({ slotStart: r.slot_start })));
      if (!hRes.error) setHolidays(((hRes.data ?? []) as Array<{ holiday_date: string }>).map((r) => ({ date: r.holiday_date })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const dayKeyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const days = useMemo(() => {
    const out: Array<{ key: string; dayNum: number; weekdayLabel: string; hasWindow: boolean; isHoliday: boolean; bookingCount: number; isToday: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const key = dayKeyOf(d);
      const hol = holidays.some((h) => h.date === key);
      const hasOverride = dateWindows.some((dw) => dw.date === key);
      const hasWeekly = windows.some((w) => w.weekday === d.getDay());
      const bkCount = bookings.filter((b) => {
        const bd = new Date(b.slotStart); bd.setHours(0, 0, 0, 0);
        return bd.getTime() === d.getTime();
      }).length;
      out.push({
        key,
        dayNum: d.getDate(),
        weekdayLabel: d.toLocaleDateString([], { weekday: "short" }).slice(0, 3),
        hasWindow: !hol && (hasOverride || hasWeekly),
        isHoliday: hol,
        bookingCount: bkCount,
        isToday: i === 0,
      });
    }
    return out;
  }, [today, windows, dateWindows, bookings, holidays]);

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Next 7 days
        </h2>
        <a
          href="/calendar"
          className="text-[11px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--primary)" }}
        >
          Open calendar →
        </a>
      </header>
      {loading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => (
            <div
              key={d.key}
              className="flex flex-col items-center gap-0.5 rounded-md py-1.5"
              style={{
                backgroundColor: d.isToday
                  ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                  : "transparent",
              }}
              title={d.isHoliday ? "Off" : d.hasWindow ? `${d.bookingCount} booking${d.bookingCount === 1 ? "" : "s"}` : "No windows"}
            >
              <span
                className="text-[9px] font-semibold uppercase tracking-wider"
                style={{ color: d.isToday ? "var(--primary)" : "var(--text-muted)" }}
              >
                {d.weekdayLabel}
              </span>
              <span
                className="text-[13px] font-semibold tabular-nums"
                style={{
                  color: d.isToday ? "var(--primary)" : "var(--text)",
                  textDecoration: d.isHoliday ? "line-through" : "none",
                }}
              >
                {d.dayNum}
              </span>
              <div className="flex h-2 items-center gap-0.5">
                {d.bookingCount > 0 ? (
                  Array.from({ length: Math.min(d.bookingCount, 3) }).map((_, k) => (
                    <span key={k} className="size-1 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
                  ))
                ) : d.hasWindow ? (
                  <span className="size-1 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DashboardFooterEscalate — supervisor escalation demoted from a full
// card to a quiet footer link. Opens the same modal as the prior card
// but lives at page-bottom where engineers expect to find "help" links.
// ──────────────────────────────────────────────────────────────────────────
function DashboardFooterEscalate() {
  const [open, setOpen] = useState(false);
  const closeEscalate = useCallback(() => setOpen(false), []);
  const dialogRef = useOverlayDismiss<HTMLDivElement>(closeEscalate, open);
  return (
    <>
      <div
        className="mt-2 flex items-center justify-center gap-2 border-t pt-4 text-[12px]"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <LifeBuoy size={11} />
        <span>Need to escalate?</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium underline-offset-2 hover:underline"
          style={{ color: URGENT_AMBER }}
        >
          Contact supervisor
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-6"
          style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(4px)" }}
        >
          <div
            ref={dialogRef}
            className="relative w-full max-w-md rounded-2xl border p-6 shadow-xl"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <h3 className="mb-2 text-base font-semibold" style={{ color: "var(--text)" }}>
              Contact your supervisor
            </h3>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              In-app chat + 1-click Zoom with your assigned supervisor is coming in a follow-up. For now:
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 text-[13px]" style={{ color: "var(--text)" }}>
              <li>📧 Email <a href="mailto:ops@relay.green" className="underline" style={{ color: "var(--primary)" }}>ops@relay.green</a> for non-urgent matters</li>
              <li>📱 Use your usual emergency Slack/WhatsApp channel for live incidents</li>
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PresenceCard() {
  const sbRef = useRef(createClient());
  const [presence, setPresence] = useState<Presence | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;
      const { data } = await sb
        .from("engineer_profiles")
        .select("presence_state, is_available")
        .eq("user_id", me)
        .maybeSingle();
      if (!alive) return;
      const row = (data ?? null) as { presence_state: string | null; is_available: boolean | null } | null;
      if (!row) { setPresence("offline"); return; }
      if (isPresence(row.presence_state)) setPresence(row.presence_state);
      else setPresence(row.is_available ? "online" : "offline");

      // Realtime — mirror changes from the top-right pill or another tab.
      // Per-mount UUID suffix on channel name + ref-tracked cleanup so a
      // leaked subscription doesn't collide on the next mount.
      const suffix = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      ch = sb
        .channel(`dash-presence-${me}-${suffix}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "engineer_profiles", filter: `user_id=eq.${me}` },
          (payload) => {
            const next = payload.new as { presence_state?: string | null; is_available?: boolean | null } | null;
            if (!next) return;
            if (isPresence(next.presence_state)) setPresence(next.presence_state);
            else if (typeof next.is_available === "boolean") setPresence(next.is_available ? "online" : "offline");
          },
        )
        .subscribe();
    })();
    return () => {
      alive = false;
      if (ch) sb.removeChannel(ch);
    };
  }, []);

  const onSet = useCallback(async (next: Presence) => {
    if (busy || presence === next) return;
    const previous = presence;
    setPresence(next);
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_presence", { _state: next });
      if (error) {
        setPresence(previous);
        console.warn("[presence] set failed:", error.message);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, presence]);

  // UI label is "Available" (more natural for engineers) but the DB value
  // stays 'online' so the matcher / RPC contract is unchanged.
  const opts: Array<{ value: Presence; label: string; blurb: string; color: string; bg: string }> = [
    { value: "online",  label: "Available", blurb: "Matcher rings me · customers see instant-call",  color: BRAND_GREEN,    bg: BRAND_GREEN_SOFT },
    { value: "busy",    label: "Busy",      blurb: "Matcher skips me · customers can drop a request", color: URGENT_AMBER,   bg: URGENT_AMBER_SOFT },
    { value: "offline", label: "Offline",   blurb: "Matcher skips me · customers see calendar booking", color: "#94a3b8",    bg: "rgba(148, 163, 184, 0.14)" },
  ];

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Your presence</h2>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {presence === null ? "Loading…" : `Currently ${presence}`}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => {
          const isActive = presence === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={busy || presence === null}
              onClick={() => void onSet(o.value)}
              aria-pressed={isActive}
              className="flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all disabled:opacity-50"
              style={{
                borderColor: isActive ? o.color : "var(--border)",
                backgroundColor: isActive ? o.bg : "var(--surface-raised)",
                boxShadow: isActive ? `0 0 0 1px ${o.color}` : "none",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
                <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                  {o.label}
                </span>
                {isActive && <Check size={11} style={{ color: o.color }} />}
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                {o.blurb}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── UI parts ───────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  link,
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: BRAND_GREEN, fontWeight: 500 }}
          >
            {link.label} →
          </Link>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function QueueRow({ session, onTake }: { session: GuestCall; onTake: () => void }) {
  const u = session.urgency;
  const accent = u === "critical" ? { bg: CRIT_RED_SOFT, fg: CRIT_RED }
    : u === "urgent" ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN };
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent.fg }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{session.guest_email}</span>
          {u !== "normal" && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: accent.bg, color: accent.fg }}>
              <AlertTriangle size={10} /> {u}
            </span>
          )}
          {session.recall_count > 0 && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              ↻ {session.recall_count}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onTake}
        className="rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        Take
      </button>
    </div>
  );
}

function ActiveRow({ session, onOpen }: { session: GuestCall; onOpen: () => void }) {
  const elapsedMin = session.joined_at
    ? Math.max(0, Math.floor((Date.now() - new Date(session.joined_at).getTime()) / 60000))
    : 0;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border-t"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{session.guest_email}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
            {session.status}
          </span>
        </div>
      </div>
      {session.status === "live" && (
        <span className="font-mono tabular-nums text-xs" style={{ color: "var(--text-muted)" }}>
          {String(elapsedMin).padStart(2, "0")}m
        </span>
      )}
      <span style={{ color: "var(--text-muted)" }}>→</span>
    </button>
  );
}

function RecentRow({ session }: { session: GuestCall }) {
  const cfg = session.status === "live"
    ? { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN, label: "live" }
    : session.status === "queued"
    ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, label: "waiting" }
    : { bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)", label: session.status };
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {new Date(session.created_at).toLocaleString([], {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>
      </div>
      {session.duration_minutes != null && (
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {Math.round(Number(session.duration_minutes))}m
        </span>
      )}
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
        {cfg.label}
      </span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-5 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
      {text}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PendingCallbacksCard — dedicated visual real estate for customers who
// asked the engineer to call them back while presence was Busy. Sits at
// the top of the dashboard above NowSection. Renders ONLY when there is
// at least one pending request; rows fall out automatically via the
// realtime subscription in DashboardClient when the request transitions
// out of "pending" (accepted / declined / expired).
//
// Visually distinct from NowSection on purpose: requests are not "right
// now" urgency, they're "this customer is waiting for you specifically".
// The EngineerPresenceBall rings 30s after the engineer transitions to
// Online; this card is the place the engineer goes to act on it.
// ──────────────────────────────────────────────────────────────────────────
function PendingCallbacksCard({
  requests, actionBusyId, onAccept, onDecline,
}: {
  requests: IncomingRequest[];
  actionBusyId: string | null;
  onAccept: (r: IncomingRequest) => Promise<void>;
  onDecline: (r: IncomingRequest) => Promise<void>;
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: "color-mix(in srgb, " + URGENT_AMBER + " 38%, transparent)",
        backgroundColor: "color-mix(in srgb, " + URGENT_AMBER + " 6%, var(--surface))",
        boxShadow: "0 2px 8px color-mix(in srgb, " + URGENT_AMBER + " 12%, transparent)",
      }}
    >
      <header
        className="flex items-center gap-2 border-b px-5 py-2.5"
        style={{ borderColor: "color-mix(in srgb, " + URGENT_AMBER + " 28%, transparent)" }}
      >
        <PhoneIncoming size={14} style={{ color: URGENT_AMBER }} />
        <h2
          className="flex-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: URGENT_AMBER }}
        >
          {requests.length === 1
            ? "1 customer is waiting for a callback"
            : `${requests.length} customers are waiting for a callback`}
        </h2>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Auto-rings 30s after you go Online
        </span>
      </header>
      <ul>
        {requests.map((r) => (
          <li key={r.id}>
            <CallbackRow
              request={r}
              busy={actionBusyId === r.id}
              onAccept={() => void onAccept(r)}
              onDecline={() => void onDecline(r)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// One row inside PendingCallbacksCard. Same data as RequestRow but a
// different layout: customer name + project are the primary text (larger
// + heavier) so a glance at the dashboard reads "Pranay · mywebsite.com"
// instead of "Request · Pranay".
function CallbackRow({
  request, busy, onAccept, onDecline,
}: {
  request: IncomingRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 border-t px-5 py-3"
      style={{ borderColor: "color-mix(in srgb, " + URGENT_AMBER + " 18%, transparent)" }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
        aria-hidden
      >
        <PhoneIncoming size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold leading-tight" style={{ color: "var(--text)" }}>
            {request.customerName ?? request.customerEmail ?? "Customer"}
          </span>
          {request.projectName && (
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              · {request.projectName}
            </span>
          )}
          <span className="ml-auto text-[11px]" style={{ color: "var(--text-faint)" }}>
            waiting {timeAgo(new Date(request.createdAt))}
          </span>
        </div>
        {request.message && (
          <p className="mt-1 text-[12px] italic" style={{ color: "var(--text-muted)" }}>
            &ldquo;{request.message}&rdquo;
          </p>
        )}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <PhoneIncoming size={11} />}
            Connect now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <X size={11} />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Incoming-section rows ───────────────────────────────────────────────
function RequestRow({
  request, busy, onAccept, onDecline,
}: {
  request: IncomingRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 border-t px-5 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--warn, " + URGENT_AMBER + ") 4%, transparent)",
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
        style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
      >
        <PhoneIncoming size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
          >
            Request
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {request.customerName ?? request.customerEmail ?? "Customer"}
          </span>
          {request.projectName && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              · {request.projectName}
            </span>
          )}
          <span className="ml-auto text-[11px]" style={{ color: "var(--text-faint)" }}>
            {timeAgo(new Date(request.createdAt))}
          </span>
        </div>
        {request.message && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            &ldquo;{request.message}&rdquo;
          </p>
        )}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <X size={10} />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingRow({
  booking, busy, onCancel,
}: {
  booking: IncomingBooking;
  busy: boolean;
  onCancel: () => void;
}) {
  const start = new Date(booking.slotStart);
  const end = new Date(booking.slotEnd);
  const now = Date.now();
  const minsToStart = Math.round((start.getTime() - now) / 60_000);
  const isLive = minsToStart <= 0 && now < end.getTime();
  const isImminent = minsToStart > 0 && minsToStart <= 15;

  const relLabel = isLive
    ? "Live now"
    : isImminent
      ? `In ${minsToStart} min`
      : start.toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

  const accent = isLive ? BRAND_GREEN : isImminent ? URGENT_AMBER : "#0ea5e9";
  const accentSoft = isLive ? BRAND_GREEN_SOFT : isImminent ? URGENT_AMBER_SOFT : "rgba(14, 165, 233, 0.14)";

  return (
    <div
      className="flex items-start gap-3 border-t px-5 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: accentSoft, color: accent }}
      >
        <CalendarIcon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: accentSoft, color: accent }}
          >
            {isLive ? "Live" : isImminent ? "Soon" : "Scheduled"}
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {booking.customerName ?? booking.customerEmail ?? "Customer"}
          </span>
          {booking.projectName && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              · {booking.projectName}
            </span>
          )}
          <span className="ml-auto text-[11px] tabular-nums" style={{ color: "var(--text)" }}>
            {relLabel}
          </span>
        </div>
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} →
          {" "}{end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        {booking.notes && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            &ldquo;{booking.notes}&rdquo;
          </p>
        )}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            title="Cancel this booking"
          >
            <X size={10} />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Relative-time formatter for the request created_at. "Just now" /
// "5 min ago" / "2 hr ago" / "yesterday" / explicit date.
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
