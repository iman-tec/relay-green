"use client";

/*
 * Customer-side modal for booking a future slot on an engineer's calendar.
 * Two-panel layout: a month calendar on the left, a duration chip + timezone
 * picker + scrollable list of start times on the right.
 *
 * Slot math is client-side and timezone-correct:
 *   • the engineer stores availability windows with an IANA timezone, so a
 *     window's start/end MINUTES are interpreted in the ENGINEER's zone to get
 *     an absolute instant (zonedToUtc);
 *   • that instant is DISPLAYED in the customer-selected timezone (the dropdown
 *     defaults to the customer's own zone);
 *   • we book the absolute instant (toISOString) — the engineer/supervisor side
 *     renders it back in their own clock.
 *
 * Only the slot START time is shown (15-min grid for engineers, 30 for
 * supervisors). A booked slot also hides the slots within a 15-min buffer
 * before and after it, so calls never sit back-to-back.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarCheck,
  Calendar as CalendarIcon,
  Clock,
  Search,
  Video,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  buildTzOptions,
  filterTzOptions,
  tzOffsetMs,
  cityOf,
  type TzOption,
} from "@/lib/relay/timezones";

type Window = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
};

type Booking = {
  slotStart: string;
  slotEnd: string;
};

type Holiday = {
  date: string; // ISO yyyy-mm-dd in the engineer's local clock
  label: string | null;
  kind: string;
};

type DateOverride = {
  date: string; // ISO yyyy-mm-dd
  startMinute: number;
  endMinute: number;
};

type Slot = { start: Date; end: Date };

// How far out we let a customer book + load calendar data for.
const HORIZON_DAYS = 56; // 8 weeks
const BUFFER_MIN = 15; // gap enforced before/after every booking
const DURATION_OPTIONS = [10, 15, 30] as const; // selectable booking lengths

// ── timezone helpers ───────────────────────────────────────────────────────
// tzOffsetMs / buildTzOptions / filterTzOptions / cityOf are shared with the
// supervisor modal via lib/relay/timezones. Only the slot-math helper below
// is local.

// Interpret (y, monthIdx, day, minutes-from-midnight) IN `timeZone` → UTC Date.
function zonedToUtc(
  y: number,
  monthIdx: number,
  day: number,
  minutes: number,
  timeZone: string
): Date {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const guess = Date.UTC(y, monthIdx, day, hh, mm);
  const off = tzOffsetMs(timeZone, new Date(guess));
  return new Date(guess - off);
}

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ScheduleEngineerModal({
  engineerUserId,
  engineerName,
  projectId,
  onClose,
  onBooked,
  durationMinutes = 15,
}: {
  engineerUserId: string;
  engineerName: string;
  projectId: string | null;
  onClose: () => void;
  onBooked: (booking: { slotStart: string; slotEnd: string }) => void;
  /** Booking length. 15 for engineers, 30 for supervisors. */
  durationMinutes?: number;
}) {
  const [windows, setWindows] = useState<Window[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [dateOverrides, setDateOverrides] = useState<DateOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookedSlot, setBookedSlot] = useState<Slot | null>(null);
  // Captured once when the modal opens — keeps the slot useMemo pure.
  const [nowMs] = useState(() => Date.now());
  const [duration, setDuration] = useState<number>(durationMinutes);
  // Calendly-style confirm step: clicking a time arms it (splits the row
  // into [time | Confirm]); only Confirm actually books. Cleared whenever
  // the day or duration changes so a stale selection can't be confirmed.
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  // Booking horizon: the CURRENT WEEK (through Sunday) at most — except
  // when opened on Friday/Saturday/Sunday, where the remaining week is
  // (almost) gone: then the horizon extends through the end of NEXT week
  // so there's always a usable booking window (an engineer with weekday
  // availability would otherwise show "No upcoming availability" every
  // Friday).
  const horizonEnd = useMemo(() => {
    const d = new Date(today);
    const dow = d.getDay(); // Sun=0 … Sat=6
    const daysToSunday = (7 - dow) % 7;
    const extendNextWeek = dow === 5 || dow === 6 || dow === 0 ? 7 : 0;
    d.setDate(d.getDate() + daysToSunday + extendNextWeek);
    return d;
  }, [today]);

  const [viewMonth, setViewMonth] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [activeDay, setActiveDay] = useState<Date | null>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const [selectedTz, setSelectedTz] = useState<string>(browserTz);

  // Searchable timezone picker (matches the supervisor modal) — full IANA list
  // with live offsets, searchable by country / city / offset. Built once on
  // mount; this modal only renders client-side (after a click), so the lazy
  // initializer can't cause an SSR/hydration mismatch.
  const [tzOptions] = useState<TzOption[]>(() => buildTzOptions());
  const [tzOpen, setTzOpen] = useState(false);
  const [tzQuery, setTzQuery] = useState("");
  const tzRef = useRef<HTMLDivElement>(null);

  // Close the zone dropdown on outside-click / ESC.
  useEffect(() => {
    if (!tzOpen) return;
    const onDown = (e: MouseEvent) => {
      if (tzRef.current && !tzRef.current.contains(e.target as Node)) {
        setTzOpen(false);
        setTzQuery("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTzOpen(false);
        setTzQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tzOpen]);

  const selectedTzLabel = useMemo(
    () =>
      tzOptions.find((o) => o.tz === selectedTz)?.label ?? cityOf(selectedTz),
    [tzOptions, selectedTz]
  );
  const filteredTz = useMemo(
    () => filterTzOptions(tzOptions, tzQuery),
    [tzOptions, tzQuery]
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();
        const from = today;
        const to = new Date(horizonEnd);
        to.setDate(to.getDate() + 1);

        const [wRes, bRes, hRes, dwRes] = await Promise.all([
          sb
            .from("engineer_availability_windows")
            .select("weekday, start_minute, end_minute, timezone")
            .eq("engineer_user_id", engineerUserId),
          sb
            .from("engineer_bookings")
            .select("slot_start, slot_end")
            .eq("engineer_user_id", engineerUserId)
            .eq("status", "booked")
            .gte("slot_start", from.toISOString())
            .lt("slot_start", to.toISOString()),
          sb
            .from("engineer_holidays")
            .select("holiday_date, label, kind")
            .eq("engineer_user_id", engineerUserId)
            .gte("holiday_date", from.toISOString().slice(0, 10))
            .lt("holiday_date", to.toISOString().slice(0, 10)),
          sb
            .from("engineer_date_windows")
            .select("the_date, start_minute, end_minute")
            .eq("engineer_user_id", engineerUserId)
            .gte("the_date", from.toISOString().slice(0, 10))
            .lt("the_date", to.toISOString().slice(0, 10)),
        ]);
        if (!alive) return;
        if (wRes.error) throw new Error(wRes.error.message);
        if (bRes.error) throw new Error(bRes.error.message);
        if (hRes.error) throw new Error(hRes.error.message);
        setWindows(
          (
            (wRes.data ?? []) as Array<{
              weekday: number;
              start_minute: number;
              end_minute: number;
              timezone: string;
            }>
          ).map((r) => ({
            weekday: r.weekday,
            startMinute: r.start_minute,
            endMinute: r.end_minute,
            timezone: r.timezone,
          }))
        );
        setBookings(
          (
            (bRes.data ?? []) as Array<{ slot_start: string; slot_end: string }>
          ).map((r) => ({ slotStart: r.slot_start, slotEnd: r.slot_end }))
        );
        setHolidays(
          (
            (hRes.data ?? []) as Array<{
              holiday_date: string;
              label: string | null;
              kind: string;
            }>
          ).map((r) => ({ date: r.holiday_date, label: r.label, kind: r.kind }))
        );
        if (!dwRes.error) {
          setDateOverrides(
            (
              (dwRes.data ?? []) as Array<{
                the_date: string;
                start_minute: number;
                end_minute: number;
              }>
            ).map((r) => ({
              date: r.the_date,
              startMinute: r.start_minute,
              endMinute: r.end_minute,
            }))
          );
        }
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof Error ? err.message : "Couldn't load calendar."
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [engineerUserId, today, horizonEnd]);

  const engineerTz = windows[0]?.timezone ?? browserTz;

  const holidayDates = useMemo(
    () => new Set(holidays.map((h) => h.date)),
    [holidays]
  );
  const overridesByDate = useMemo(() => {
    const m = new Map<string, DateOverride[]>();
    for (const dw of dateOverrides) {
      const arr = m.get(dw.date) ?? [];
      arr.push(dw);
      m.set(dw.date, arr);
    }
    return m;
  }, [dateOverrides]);

  // Windows that apply to a given date: holiday → none; date-override → those;
  // else the weekly pattern for that weekday.
  const windowsForDate = (
    d: Date
  ): Array<{ startMinute: number; endMinute: number }> => {
    const key = dayKeyOf(d);
    if (holidayDates.has(key)) return [];
    const ov = overridesByDate.get(key);
    if (ov && ov.length > 0) return ov;
    return windows.filter((w) => w.weekday === d.getDay());
  };

  // A date is selectable if it's within [today, horizon], not past, and has at
  // least one availability window (and isn't a holiday).
  const isSelectable = (d: Date): boolean => {
    if (d < today || d > horizonEnd) return false;
    return windowsForDate(d).length > 0;
  };

  // Default to the first bookable day so times show immediately — no dead
  // "pick a day" state. A manual click overrides this via activeDay.
  const firstAvailable = useMemo(() => {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      if (isSelectable(d)) return d;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, windows, holidayDates, overridesByDate]);
  const effectiveDay = activeDay ?? firstAvailable;

  // Open slots for the effective day, in absolute instants, with the buffer applied.
  const slots: Slot[] = useMemo(() => {
    if (!effectiveDay) return [];
    const dayWindows = windowsForDate(effectiveDay);
    if (dayWindows.length === 0) return [];

    const y = effectiveDay.getFullYear();
    const mo = effectiveDay.getMonth();
    const da = effectiveDay.getDate();
    const bufferMs = BUFFER_MIN * 60_000;
    const durMs = duration * 60_000;

    const out: Slot[] = [];
    for (const w of dayWindows) {
      let m = w.startMinute;
      while (m + duration <= w.endMinute) {
        const start = zonedToUtc(y, mo, da, m, engineerTz);
        const end = new Date(start.getTime() + durMs);
        const startMs = start.getTime();
        const endMs = end.getTime();
        // Block if in the past or within BUFFER of an existing booking.
        const blocked =
          startMs < nowMs ||
          bookings.some((b) => {
            const bs = new Date(b.slotStart).getTime();
            const be = new Date(b.slotEnd).getTime();
            return startMs < be + bufferMs && endMs > bs - bufferMs;
          });
        if (!blocked) out.push({ start, end });
        m += 15; // 15-min START grid regardless of duration
      }
    }
    out.sort((a, b) => a.start.getTime() - b.start.getTime());
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveDay,
    windows,
    bookings,
    holidayDates,
    overridesByDate,
    engineerTz,
    duration,
    nowMs,
  ]);

  // Calendar grid for the visible month: 6 weeks × 7 days, Monday-first.
  const monthCells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstWeekday);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [viewMonth]);

  const canPrevMonth =
    viewMonth > new Date(today.getFullYear(), today.getMonth(), 1);
  const canNextMonth =
    viewMonth < new Date(horizonEnd.getFullYear(), horizonEnd.getMonth(), 1);

  const submitBooking = async (slot: Slot) => {
    setBooking(true);
    setError(null);
    try {
      const sb = createClient();
      const { error: rpcErr } = await sb.rpc("book_engineer_slot", {
        _engineer_user_id: engineerUserId,
        _project_id: projectId,
        _slot_start: slot.start.toISOString(),
        _slot_end: slot.end.toISOString(),
        _notes: null,
      });
      if (rpcErr) {
        // Atomic-claim loser, or any overlap → tell them to pick another.
        const msg = /SLOT_UNAVAILABLE|duplicate|unique/i.test(rpcErr.message)
          ? "That slot was just taken — pick another."
          : rpcErr.message;
        throw new Error(msg);
      }
      setBookedSlot(slot);
      // Tell the sidebar pill + center view to refresh immediately (works
      // even before the realtime publication change lands).
      window.dispatchEvent(new Event("relay:scheduled-changed"));
      onBooked({
        slotStart: slot.start.toISOString(),
        slotEnd: slot.end.toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the slot.");
      // A taken slot should disappear — drop it from the list.
      setBookings((prev) => [
        ...prev,
        {
          slotStart: slot.start.toISOString(),
          slotEnd: slot.end.toISOString(),
        },
      ]);
    } finally {
      setBooking(false);
    }
  };

  // Day label for the slots column, e.g. "Tuesday, Jun 2".
  const dayLabel = effectiveDay
    ? effectiveDay.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "";

  // ── Success confirmation ───────────────────────────────────────────────────
  if (bookedSlot) {
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat([], { timeZone: selectedTz, ...opts }).format(d);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        style={{
          backgroundColor: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm rounded-2xl border p-7 text-center shadow-2xl"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <CalendarCheck size={22} />
          </div>
          <h2
            className="text-lg font-medium"
            style={{
              fontFamily: "var(--font-source-serif)",
              color: "var(--text)",
            }}
          >
            Session requested with {engineerName}
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {fmt(bookedSlot.start, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p
            className="mt-0.5 text-[15px] font-semibold tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {fmt(bookedSlot.start, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
            {" – "}
            {fmt(bookedSlot.end, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </p>
          <p
            className="mt-3 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {engineerName} has been notified. You&apos;ll get a reminder before
            it starts.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-full py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--primary)" }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-4 py-6"
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-xl"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
          maxHeight: "min(90vh, 620px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Calendly-style chrome: no full-width header bar — the left info
            pane owns the identity; close floats top-right. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>

        {loading ? (
          <div className="flex items-center justify-center px-5 py-16">
            <Loader2
              className="size-4 animate-spin"
              style={{ color: "var(--text-muted)" }}
            />
          </div>
        ) : windows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: "var(--text)" }}>
              {engineerName} hasn&apos;t set up calendar availability yet.
            </p>
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              Try a different engineer, or send a connect request instead.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
            {/* LEFT — engineer / event info (Calendly's host pane). On
                mobile it compacts into horizontal rows so the calendar
                stays above the fold; on sm+ it's the classic info column. */}
            <div
              className="border-b p-4 sm:w-[200px] sm:shrink-0 sm:border-r sm:border-b-0 sm:p-5"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <CalendarIcon size={14} style={{ color: "var(--primary)" }} />
                <span
                  className="text-[11px] font-semibold tracking-[0.12em] uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Relay
                </span>
              </div>
              {/* Identity: avatar beside name/title on mobile, stacked on
                  sm+. Initials circle — engineer aliases have no avatar
                  URLs. */}
              <div className="mt-3 flex items-center gap-3 sm:mt-4 sm:block">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold"
                  style={{
                    backgroundColor: "var(--primary-soft)",
                    color: "var(--primary)",
                    fontFamily: "var(--font-source-serif)",
                  }}
                  aria-hidden
                >
                  {engineerName
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div
                    className="truncate text-[12.5px] sm:mt-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {engineerName}
                  </div>
                  <h2
                    className="mt-0.5 text-[17px] leading-snug font-semibold"
                    style={{
                      color: "var(--text)",
                      fontFamily: "var(--font-source-serif)",
                    }}
                  >
                    Engineering session
                  </h2>
                </div>
              </div>
              {/* Meta — one row on mobile, stacked on sm+. */}
              <div className="mt-3 flex items-center gap-4 sm:block">
                <div
                  className="flex items-center gap-2 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Clock size={13} className="shrink-0" />
                  {duration} min
                </div>
                <div
                  className="flex items-center gap-2 text-[12px] sm:mt-1.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Video size={13} className="shrink-0" />
                  Zoom
                </div>
              </div>
              {/* Duration picker — kept from the old layout, restyled to fit
                  the quiet info column. */}
              <div
                className="mt-3 text-[10.5px] font-semibold tracking-[0.1em] uppercase sm:mt-4"
                style={{ color: "var(--text-faint)" }}
              >
                How long do you need?
              </div>
              <div
                className="mt-1.5 inline-flex rounded-lg border p-0.5"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-raised)",
                }}
              >
                {DURATION_OPTIONS.map((opt) => {
                  const on = duration === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setDuration(opt);
                        setPendingSlot(null);
                      }}
                      className="rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                      style={{
                        backgroundColor: on ? "var(--surface)" : "transparent",
                        color: on ? "var(--text)" : "var(--text-muted)",
                        boxShadow: on ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                      }}
                    >
                      {opt}m
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CENTER — "Select a Date & Time" month calendar. */}
            <div
              className="min-w-0 flex-1 border-b p-5 sm:border-r sm:border-b-0"
              style={{ borderColor: "var(--border)" }}
            >
              <h3
                className="mb-3 text-[15px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Select a Date &amp; Time
              </h3>
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={!canPrevMonth}
                  onClick={() =>
                    setViewMonth(
                      (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)
                    )
                  }
                  aria-label="Previous month"
                  className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-30"
                  style={{ color: "var(--text)" }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                </span>
                <button
                  type="button"
                  disabled={!canNextMonth}
                  onClick={() =>
                    setViewMonth(
                      (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)
                    )
                  }
                  aria-label="Next month"
                  className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-30"
                  style={{ color: "var(--text)" }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((w) => (
                  <div
                    key={w}
                    className="pb-1 text-center text-[10px] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {w}
                  </div>
                ))}
                {monthCells.map((d) => {
                  const inMonth = d.getMonth() === viewMonth.getMonth();
                  const selectable = inMonth && isSelectable(d);
                  const isActive =
                    !!effectiveDay && d.getTime() === effectiveDay.getTime();
                  const isHoliday = holidayDates.has(dayKeyOf(d));
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      disabled={!selectable}
                      onClick={() => {
                        setActiveDay(new Date(d));
                        setPendingSlot(null);
                      }}
                      title={
                        isHoliday && inMonth
                          ? `${engineerName} is off this day`
                          : undefined
                      }
                      className="flex aspect-square items-center justify-center rounded-full text-[13px] transition-colors"
                      style={{
                        color: isActive
                          ? "#fff"
                          : selectable
                            ? "var(--primary)"
                            : inMonth
                              ? "var(--text-faint)"
                              : "transparent",
                        // Calendly treatment: every bookable day wears a
                        // soft tinted circle; the selected day is filled.
                        backgroundColor: isActive
                          ? "var(--primary)"
                          : selectable
                            ? "var(--primary-soft)"
                            : "transparent",
                        fontWeight: selectable ? 600 : 400,
                        cursor: selectable ? "pointer" : "default",
                        textDecoration:
                          isHoliday && inMonth ? "line-through" : "none",
                      }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>

              {/* Timezone — bottom of the calendar pane, Calendly-style. */}
              <div
                className="mt-4 text-[10.5px] font-semibold tracking-[0.1em] uppercase"
                style={{ color: "var(--text-faint)" }}
              >
                Time zone
              </div>
              <div ref={tzRef} className="relative mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setTzOpen((o) => !o);
                    setTzQuery("");
                  }}
                  aria-expanded={tzOpen}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  <span className="truncate">{selectedTzLabel}</span>
                  <ChevronDown
                    size={12}
                    className={
                      tzOpen
                        ? "shrink-0 rotate-180 transition-transform"
                        : "shrink-0 transition-transform"
                    }
                  />
                </button>
                {tzOpen && (
                  <div
                    role="listbox"
                    aria-label="Timezone"
                    // Drops UP: the trigger sits at the bottom of the
                    // calendar pane, so a downward menu gets clipped by the
                    // modal's overflow-hidden shell.
                    className="absolute bottom-full left-0 z-10 mb-1 flex max-h-72 w-72 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg border shadow-xl"
                    style={{
                      background: "var(--surface)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 border-b px-2.5 py-2"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <Search
                        size={13}
                        style={{ color: "var(--text-muted)" }}
                      />
                      <input
                        autoFocus
                        value={tzQuery}
                        onChange={(e) => setTzQuery(e.target.value)}
                        placeholder="Search country or city…"
                        className="w-full bg-transparent text-[12px] outline-none"
                        style={{ color: "var(--text)" }}
                      />
                    </div>
                    <div className="overflow-y-auto">
                      {filteredTz.length === 0 ? (
                        <div
                          className="px-3 py-4 text-center text-[12px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          No matches.
                        </div>
                      ) : (
                        filteredTz.map((o) => {
                          const sel = o.tz === selectedTz;
                          return (
                            <button
                              key={o.tz}
                              type="button"
                              role="option"
                              aria-selected={sel}
                              onClick={() => {
                                setSelectedTz(o.tz);
                                setTzOpen(false);
                                setTzQuery("");
                              }}
                              className="block w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-raised)]"
                              style={{
                                color: "var(--text)",
                                background: sel
                                  ? "var(--primary-soft)"
                                  : "transparent",
                                fontWeight: sel ? 600 : 400,
                              }}
                            >
                              {o.label}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — day label + time slots (Calendly's times rail).
                Clicking a time arms it: the row splits into a greyed time
                + a green Confirm button; only Confirm books. */}
            <div className="flex min-w-0 flex-col p-5 sm:w-[230px] sm:shrink-0">
              <div
                className="mb-3 text-[13px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                {dayLabel || "Pick a date"}
              </div>
              <div className="min-h-[160px] flex-1 sm:max-h-[420px] sm:overflow-y-auto">
                {!effectiveDay ? (
                  <p
                    className="py-8 text-center text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No upcoming availability for {engineerName}.
                  </p>
                ) : slots.length === 0 ? (
                  <p
                    className="py-8 text-center text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No open times on {dayLabel}.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 pr-0.5">
                    {slots.map((s) => {
                      const timeLabel = new Intl.DateTimeFormat([], {
                        timeZone: selectedTz,
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }).format(s.start);
                      const armed =
                        pendingSlot &&
                        pendingSlot.start.getTime() === s.start.getTime();
                      if (armed) {
                        return (
                          <div
                            key={s.start.toISOString()}
                            className="flex gap-1.5"
                          >
                            <span
                              className="flex flex-1 items-center justify-center rounded-lg px-2 py-2.5 text-center text-[13px] font-semibold tabular-nums"
                              style={{
                                backgroundColor:
                                  "color-mix(in srgb, var(--text) 14%, transparent)",
                                color: "var(--text)",
                              }}
                            >
                              {timeLabel}
                            </span>
                            <button
                              type="button"
                              disabled={booking}
                              onClick={() => void submitBooking(s)}
                              className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                              style={{ backgroundColor: "var(--primary)" }}
                            >
                              {booking ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                "Confirm"
                              )}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={s.start.toISOString()}
                          type="button"
                          disabled={booking}
                          onClick={() => setPendingSlot(s)}
                          className="rounded-lg border px-4 py-2.5 text-center text-[13px] font-semibold tabular-nums transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
                          style={{
                            borderColor: "var(--primary)",
                            backgroundColor: "transparent",
                            color: "var(--primary)",
                          }}
                        >
                          {timeLabel}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            className="border-t px-5 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-[12px]" style={{ color: "var(--accent-red)" }}>
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
