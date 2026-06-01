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

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, ChevronLeft, ChevronRight, ChevronDown, CalendarCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

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
  date: string;            // ISO yyyy-mm-dd in the engineer's local clock
  label: string | null;
  kind: string;
};

type DateOverride = {
  date: string;            // ISO yyyy-mm-dd
  startMinute: number;
  endMinute: number;
};

type Slot = { start: Date; end: Date };

// How far out we let a customer book + load calendar data for.
const HORIZON_DAYS = 56;          // 8 weeks
const BUFFER_MIN = 15;            // gap enforced before/after every booking
const DURATION_OPTIONS = [10, 15, 30] as const;  // selectable booking lengths

// ── timezone helpers ───────────────────────────────────────────────────────
// Offset (ms) of `timeZone` from UTC at a given instant. Positive = ahead of
// UTC. Single-pass formatToParts approach — robust across locales + DST.
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year, +map.month - 1, +map.day,
    +map.hour % 24, +map.minute, +map.second,
  );
  return asUTC - at.getTime();
}

// Interpret (y, monthIdx, day, minutes-from-midnight) IN `timeZone` → UTC Date.
function zonedToUtc(y: number, monthIdx: number, day: number, minutes: number, timeZone: string): Date {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const guess = Date.UTC(y, monthIdx, day, hh, mm);
  const off = tzOffsetMs(timeZone, new Date(guess));
  return new Date(guess - off);
}

// "UTC+05:30" style label for a zone at `now`.
function tzShortOffset(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return off.replace("GMT", "UTC");
  } catch {
    return "UTC";
  }
}

// Curated timezone options. The customer's own zone is prepended at runtime.
const TZ_OPTIONS = [
  "UTC",
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney",
];

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ScheduleEngineerModal({
  engineerUserId, engineerName, projectId, onClose, onBooked,
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

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  // Bookings are limited to the CURRENT WEEK only (Mon-first calendar → through
  // the coming Sunday). No advance bookings beyond that.
  const horizonEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // getDay(): Sun=0 → end of week
    return d;
  }, [today]);

  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [activeDay, setActiveDay] = useState<Date | null>(null);

  const browserTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }, []);
  const [selectedTz, setSelectedTz] = useState<string>(browserTz);

  // Dedupe + order the timezone dropdown with the customer's own zone first.
  const tzChoices = useMemo(() => {
    const seen = new Set<string>();
    return [browserTz, ...TZ_OPTIONS].filter((tz) => {
      if (seen.has(tz)) return false;
      seen.add(tz);
      return true;
    });
  }, [browserTz]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();
        const from = today;
        const to = new Date(horizonEnd);
        to.setDate(to.getDate() + 1);

        const [wRes, bRes, hRes, dwRes] = await Promise.all([
          sb.from("engineer_availability_windows")
            .select("weekday, start_minute, end_minute, timezone")
            .eq("engineer_user_id", engineerUserId),
          sb.from("engineer_bookings")
            .select("slot_start, slot_end")
            .eq("engineer_user_id", engineerUserId)
            .eq("status", "booked")
            .gte("slot_start", from.toISOString())
            .lt("slot_start", to.toISOString()),
          sb.from("engineer_holidays")
            .select("holiday_date, label, kind")
            .eq("engineer_user_id", engineerUserId)
            .gte("holiday_date", from.toISOString().slice(0, 10))
            .lt("holiday_date", to.toISOString().slice(0, 10)),
          sb.from("engineer_date_windows")
            .select("the_date, start_minute, end_minute")
            .eq("engineer_user_id", engineerUserId)
            .gte("the_date", from.toISOString().slice(0, 10))
            .lt("the_date", to.toISOString().slice(0, 10)),
        ]);
        if (!alive) return;
        if (wRes.error) throw new Error(wRes.error.message);
        if (bRes.error) throw new Error(bRes.error.message);
        if (hRes.error) throw new Error(hRes.error.message);
        setWindows(((wRes.data ?? []) as Array<{ weekday: number; start_minute: number; end_minute: number; timezone: string }>)
          .map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute, timezone: r.timezone })));
        setBookings(((bRes.data ?? []) as Array<{ slot_start: string; slot_end: string }>)
          .map((r) => ({ slotStart: r.slot_start, slotEnd: r.slot_end })));
        setHolidays(((hRes.data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>)
          .map((r) => ({ date: r.holiday_date, label: r.label, kind: r.kind })));
        if (!dwRes.error) {
          setDateOverrides(((dwRes.data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>)
            .map((r) => ({ date: r.the_date, startMinute: r.start_minute, endMinute: r.end_minute })));
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Couldn't load calendar.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [engineerUserId, today, horizonEnd]);

  const engineerTz = windows[0]?.timezone ?? browserTz;

  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
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
  const windowsForDate = (d: Date): Array<{ startMinute: number; endMinute: number }> => {
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
      const d = new Date(today); d.setDate(d.getDate() + i);
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
        const blocked = startMs < nowMs || bookings.some((b) => {
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
  }, [effectiveDay, windows, bookings, holidayDates, overridesByDate, engineerTz, duration, nowMs]);

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

  const canPrevMonth = viewMonth > new Date(today.getFullYear(), today.getMonth(), 1);
  const canNextMonth = viewMonth < new Date(horizonEnd.getFullYear(), horizonEnd.getMonth(), 1);

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
      onBooked({ slotStart: slot.start.toISOString(), slotEnd: slot.end.toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the slot.");
      // A taken slot should disappear — drop it from the list.
      setBookings((prev) => [...prev, { slotStart: slot.start.toISOString(), slotEnd: slot.end.toISOString() }]);
    } finally {
      setBooking(false);
    }
  };

  const initial = (engineerName.trim()[0] ?? "?").toUpperCase();

  // ── Success confirmation ───────────────────────────────────────────────────
  if (bookedSlot) {
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat([], { timeZone: selectedTz, ...opts }).format(d);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm rounded-2xl border p-7 text-center shadow-2xl"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <CalendarCheck size={22} />
          </div>
          <h2 className="text-lg font-medium" style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}>
            Session requested with {engineerName}
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {fmt(bookedSlot.start, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: "var(--text)" }}>
            {fmt(bookedSlot.start, { hour: "2-digit", minute: "2-digit", hour12: false })}
            {" – "}
            {fmt(bookedSlot.end, { hour: "2-digit", minute: "2-digit", hour12: false })}
          </p>
          <p className="mt-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {engineerName} has been notified. You&apos;ll get a reminder before it starts.
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
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl overflow-hidden rounded-2xl border shadow-2xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", maxHeight: "min(90vh, 640px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/15"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          <X size={16} />
        </button>

        {/* ── Left panel: avatar + month calendar ───────────────────────── */}
        <div
          className="flex w-[44%] shrink-0 flex-col items-center px-6 py-7 text-white"
          style={{ background: "linear-gradient(160deg, var(--primary) 0%, var(--primary-hover) 100%)" }}
        >
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold"
            style={{ backgroundColor: "rgba(255,255,255,0.18)", fontFamily: "var(--font-source-serif)" }}
          >
            {initial}
          </div>
          <h2
            className="mt-3 text-center text-lg font-medium leading-snug"
            style={{ fontFamily: "var(--font-source-serif)" }}
          >
            Request a session with {engineerName}
          </h2>

          {/* Month nav */}
          <div className="mt-5 flex w-full items-center justify-center gap-4">
            <button
              type="button"
              disabled={!canPrevMonth}
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/15 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-[120px] text-center text-base font-semibold" style={{ fontFamily: "var(--font-source-serif)" }}>
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              disabled={!canNextMonth}
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/15 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Weekday header */}
          <div className="mt-5 grid w-full grid-cols-7 gap-y-2 text-center text-[10px] font-semibold tracking-wider" style={{ color: "rgba(255,255,255,0.7)" }}>
            {WEEKDAY_LABELS.map((w) => <div key={w}>{w}</div>)}
          </div>

          {/* Day grid */}
          <div className="mt-1 grid w-full grid-cols-7 gap-y-1.5 text-center">
            {monthCells.map((d) => {
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const isToday = d.getTime() === today.getTime();
              const selectable = inMonth && isSelectable(d);
              const isActive = effectiveDay && d.getTime() === effectiveDay.getTime();
              const isHoliday = holidayDates.has(dayKeyOf(d));
              return (
                <div key={d.toISOString()} className="flex justify-center">
                  <button
                    type="button"
                    disabled={!selectable}
                    onClick={() => setActiveDay(new Date(d))}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-colors"
                    style={{
                      cursor: selectable ? "pointer" : "default",
                      fontWeight: selectable ? 600 : 400,
                      color: isActive
                        ? "var(--primary)"
                        : !inMonth ? "rgba(255,255,255,0.28)"
                          : selectable ? "#fff" : "rgba(255,255,255,0.4)",
                      backgroundColor: isActive ? "#fff" : isToday ? "rgba(255,255,255,0.16)" : "transparent",
                      textDecoration: isHoliday && inMonth ? "line-through" : "none",
                    }}
                    title={isHoliday ? `${engineerName} is off this day` : undefined}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right panel: duration + timezone + times ──────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col px-6 py-7">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-5 animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : windows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {engineerName} hasn&apos;t set up calendar availability yet.
              </p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                Try a different engineer, or send a connect request instead.
              </p>
            </div>
          ) : (
            <>
              {/* Duration */}
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>How long do you need?</h3>
              <div className="mt-2 inline-flex self-start rounded-lg border p-1" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}>
                {DURATION_OPTIONS.map((opt) => {
                  const on = duration === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDuration(opt)}
                      className="rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors"
                      style={{
                        backgroundColor: on ? "var(--surface)" : "transparent",
                        color: on ? "var(--text)" : "var(--text-muted)",
                        boxShadow: on ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                      }}
                    >
                      {opt} min
                    </button>
                  );
                })}
              </div>

              {/* Timezone */}
              <h3 className="mt-5 text-sm font-semibold" style={{ color: "var(--text)" }}>What time works best?</h3>
              <div className="relative mt-1.5">
                <select
                  value={selectedTz}
                  onChange={(e) => setSelectedTz(e.target.value)}
                  className="w-full appearance-none rounded-md bg-transparent py-1 pr-7 text-[13px] font-medium outline-none"
                  style={{ color: "var(--primary)" }}
                >
                  {tzChoices.map((tz) => (
                    <option key={tz} value={tz} style={{ color: "var(--text)" }}>
                      {tzShortOffset(tz, today)} · {tz.split("/").pop()?.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" style={{ color: "var(--primary)" }} />
              </div>

              {error && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--accent-red)" }}>{error}</p>
              )}

              {/* Times */}
              <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                {!effectiveDay ? (
                  <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
                    No upcoming availability for {engineerName}.
                  </p>
                ) : slots.length === 0 ? (
                  <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
                    No open times on {effectiveDay.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}.
                  </p>
                ) : (
                  slots.map((s) => (
                    <button
                      key={s.start.toISOString()}
                      type="button"
                      disabled={booking}
                      onClick={() => void submitBooking(s)}
                      className="flex w-full items-center justify-center rounded-lg border py-3 text-[15px] font-medium transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] disabled:opacity-50"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      {new Intl.DateTimeFormat([], { timeZone: selectedTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(s.start)}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
