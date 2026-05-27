"use client";

/*
 * Customer-side modal for booking a future slot on an Offline engineer's
 * calendar. Fetches the engineer's weekly availability windows + existing
 * bookings, then computes 30-minute open slots for the next 14 days. The
 * customer picks one → we POST through book_engineer_slot.
 *
 * Slot math is intentionally client-side: it's timezone-sensitive and the
 * client knows the user's resolved zone, so doing it on the server would
 * need an explicit tz argument round-trip. The engineer also stores their
 * windows with an IANA timezone string, so the picker shows slots in the
 * engineer's local clock — labelled with the engineer's tz to avoid the
 * usual "1 PM their time or my time?" confusion.
 */

import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Loader2, X } from "lucide-react";
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

const SLOT_MIN = 30;
const DAYS_AHEAD = 14;

export function ScheduleEngineerModal({
  engineerUserId, engineerName, projectId, onClose, onBooked,
}: {
  engineerUserId: string;
  engineerName: string;
  projectId: string | null;
  onClose: () => void;
  onBooked: (booking: { slotStart: string; slotEnd: string }) => void;
}) {
  const [windows, setWindows] = useState<Window[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [dateOverrides, setDateOverrides] = useState<DateOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + DAYS_AHEAD + 1);

        // Per-date overrides (engineer_date_windows) may 404 if the
        // migration isn't applied — degrade silently to "no overrides"
        // so the customer side keeps working off the weekly pattern.
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
        setWindows(((wRes.data ?? []) as Array<{
          weekday: number;
          start_minute: number;
          end_minute: number;
          timezone: string;
        }>).map((r) => ({
          weekday: r.weekday,
          startMinute: r.start_minute,
          endMinute: r.end_minute,
          timezone: r.timezone,
        })));
        setBookings(((bRes.data ?? []) as Array<{ slot_start: string; slot_end: string }>).map((r) => ({
          slotStart: r.slot_start,
          slotEnd: r.slot_end,
        })));
        setHolidays(((hRes.data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>).map((r) => ({
          date: r.holiday_date,
          label: r.label,
          kind: r.kind,
        })));
        if (!dwRes.error) {
          setDateOverrides(((dwRes.data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>).map((r) => ({
            date: r.the_date,
            startMinute: r.start_minute,
            endMinute: r.end_minute,
          })));
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Couldn't load calendar.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [engineerUserId]);

  const engineerTz = windows[0]?.timezone ?? "UTC";

  // Check if the active day is a holiday for this engineer. Holidays
  // wipe out all slots regardless of the weekly pattern.
  const activeHoliday = useMemo(() => {
    const dayKey = `${activeDay.getFullYear()}-${String(activeDay.getMonth() + 1).padStart(2, "0")}-${String(activeDay.getDate()).padStart(2, "0")}`;
    return holidays.find((h) => h.date === dayKey) ?? null;
  }, [activeDay, holidays]);

  // Resolve which windows apply for a given local date — checking the
  // per-date overrides first, then falling back to the weekly pattern.
  // This is the model-A resolver: holiday > date_window > weekly_pattern.
  const dayKeyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const overridesByDate = useMemo(() => {
    const m = new Map<string, DateOverride[]>();
    for (const dw of dateOverrides) {
      const arr = m.get(dw.date) ?? [];
      arr.push(dw);
      m.set(dw.date, arr);
    }
    return m;
  }, [dateOverrides]);

  // Compute open slots for the active day.
  const slots: Slot[] = useMemo(() => {
    if (activeHoliday) return [];

    // Pick the right set of (start, end) windows for this specific date.
    const dayKey = dayKeyOf(activeDay);
    const overrides = overridesByDate.get(dayKey);
    let dayWindows: Array<{ startMinute: number; endMinute: number }>;
    if (overrides && overrides.length > 0) {
      dayWindows = overrides;
    } else {
      const weekday = activeDay.getDay();
      dayWindows = windows.filter((w) => w.weekday === weekday);
    }
    if (dayWindows.length === 0) return [];

    const out: Slot[] = [];
    for (const w of dayWindows) {
      let m = w.startMinute;
      while (m + SLOT_MIN <= w.endMinute) {
        const start = new Date(activeDay);
        start.setMinutes(m);
        const end = new Date(start);
        end.setMinutes(end.getMinutes() + SLOT_MIN);
        const taken = bookings.some(
          (b) => {
            const bs = new Date(b.slotStart).getTime();
            const be = new Date(b.slotEnd).getTime();
            return bs < end.getTime() && be > start.getTime();
          },
        );
        const inPast = start.getTime() < Date.now();
        if (!taken && !inPast) out.push({ start, end });
        m += SLOT_MIN;
      }
    }
    return out;
  }, [windows, bookings, activeDay, activeHoliday, overridesByDate]);

  // Pre-compute holiday dates as a Set for fast day-picker rendering.
  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);

  const dayList: Date[] = useMemo(() => {
    const out: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

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
      if (rpcErr) throw new Error(rpcErr.message);
      onBooked({ slotStart: slot.start.toISOString(), slotEnd: slot.end.toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the slot.");
    } finally {
      setBooking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <header
          className="flex items-center gap-2 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <CalendarIcon size={14} style={{ color: "var(--primary)" }} />
          <h2 className="flex-1 text-[15px] font-semibold" style={{ color: "var(--text)" }}>
            Schedule with {engineerName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="flex items-center justify-center px-5 py-10">
            <Loader2 className="size-4 animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : error ? (
          <div className="px-5 py-5">
            <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>
            {windows.length === 0 && (
              <p className="mt-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                This engineer hasn&apos;t published any calendar windows yet.
              </p>
            )}
          </div>
        ) : windows.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm" style={{ color: "var(--text)" }}>
              {engineerName} hasn&apos;t set up calendar availability yet.
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Try requesting a different engineer or sending a connect request instead.
            </p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Times shown in <span style={{ color: "var(--text)" }}>your timezone</span> · engineer is in {engineerTz}
            </div>
            <div className="border-y px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {dayList.map((d) => {
                  const active = d.toDateString() === activeDay.toDateString();
                  const dKey = dayKeyOf(d);
                  const dayOverrides = overridesByDate.get(dKey);
                  const dayWindows = (dayOverrides && dayOverrides.length > 0)
                    ? dayOverrides
                    : windows.filter((w) => w.weekday === d.getDay());
                  const isHoliday = holidayDates.has(dKey);
                  const hasAvailability = dayWindows.length > 0 && !isHoliday;
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => setActiveDay(d)}
                      disabled={!hasAvailability}
                      title={isHoliday ? "Engineer is off this day" : undefined}
                      className="relative flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 transition-colors disabled:opacity-40"
                      style={{
                        borderColor: active ? "var(--primary)" : "var(--border)",
                        backgroundColor: active
                          ? "var(--primary-soft)"
                          : hasAvailability ? "var(--surface-raised)" : "transparent",
                      }}
                    >
                      <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                        {d.toLocaleDateString([], { weekday: "short" })}
                      </span>
                      <span
                        className="text-[14px] font-semibold"
                        style={{
                          color: "var(--text)",
                          textDecoration: isHoliday ? "line-through" : "none",
                        }}
                      >
                        {d.getDate()}
                      </span>
                      {isHoliday && (
                        <span
                          aria-hidden
                          className="absolute -top-1 right-0 h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "var(--accent-red)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="max-h-[260px] overflow-y-auto px-5 py-4">
              {activeHoliday ? (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {engineerName} is off this day
                  </p>
                  {activeHoliday.label && (
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {activeHoliday.label}
                    </p>
                  )}
                </div>
              ) : slots.length === 0 ? (
                <p className="py-6 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                  No open slots on this day.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.start.toISOString()}
                      type="button"
                      disabled={booking}
                      onClick={() => void submitBooking(s)}
                      className="rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--surface-raised)",
                        color: "var(--text)",
                      }}
                    >
                      {s.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
