"use client";

/*
 * MonthAvailabilityOverview — read-only "Next 4 weeks" calendar grid for the
 * signed-in staff user (engineer OR supervisor). A self-contained sibling of
 * the dashboard's FourWeekCalendar: same 28-cell Sun–Sat × 4 layout, same
 * colour semantics (green = available window, red = holiday/off, plain = off
 * day) and the same legend, so the calendar page shows the month at a glance
 * alongside the weekly editor. It fetches the current user's availability
 * windows, per-date overrides, holidays and bookings (all owner-scoped via
 * RLS). Clicking a day opens a small read-only detail popup. No editing here —
 * the weekly/monthly editors below own all mutations.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

const BRAND_GREEN = "#3f5c2e";

function toDateInput(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

type Booking = {
  id: string;
  slotStart: string;
  slotEnd: string;
  notes: string | null;
};

export function MonthAvailabilityOverview() {
  const sbRef = useRef(createClient());
  const todayMid = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // First cell = Sunday of the week containing today; 28 days forward.
  const gridStart = useMemo(() => {
    const d = new Date(todayMid);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [todayMid]);
  const dates = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 28; i++) out.push(addDays(gridStart, i));
    return out;
  }, [gridStart]);

  type W = { weekday: number };
  const [windows, setWindows] = useState<W[]>([]);
  const [dateWindows, setDateWindows] = useState<{ date: string }[]>([]);
  const [holidays, setHolidays] = useState<
    { date: string; label: string | null }[]
  >([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
      const rangeStartIso = gridStart.toISOString();
      const rangeEndIso = addDays(gridStart, 28).toISOString();
      const [wRes, dwRes, hRes, bkRes, sbRes] = await Promise.all([
        sb
          .from("engineer_availability_windows")
          .select("weekday")
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
        sb
          .from("engineer_bookings")
          .select("id, slot_start, slot_end, notes")
          .eq("engineer_user_id", me)
          .eq("status", "booked")
          .gte("slot_start", rangeStartIso)
          .lt("slot_start", rangeEndIso)
          .order("slot_start", { ascending: true }),
        // Supervisors' own appointments live in supervisor_bookings (keyed by
        // supervisor_user_id), so the engineer_bookings query above misses
        // them. Pull them too — for an engineer this just returns nothing.
        sb
          .from("supervisor_bookings")
          .select("id, slot_start, slot_end, customer_name, project_name")
          .eq("supervisor_user_id", me)
          .eq("status", "booked")
          .gte("slot_start", rangeStartIso)
          .lt("slot_start", rangeEndIso)
          .order("slot_start", { ascending: true }),
      ]);
      if (!alive) return;
      if (!wRes.error)
        setWindows(
          ((wRes.data ?? []) as { weekday: number }[]).map((r) => ({
            weekday: r.weekday,
          }))
        );
      if (!dwRes.error)
        setDateWindows(
          ((dwRes.data ?? []) as { the_date: string }[]).map((r) => ({
            date: r.the_date,
          }))
        );
      if (!hRes.error)
        setHolidays(
          (
            (hRes.data ?? []) as {
              holiday_date: string;
              label: string | null;
            }[]
          ).map((r) => ({ date: r.holiday_date, label: r.label }))
        );
      const engBookings = !bkRes.error
        ? (
            (bkRes.data ?? []) as {
              id: string;
              slot_start: string;
              slot_end: string;
              notes: string | null;
            }[]
          ).map((r) => ({
            id: r.id,
            slotStart: r.slot_start,
            slotEnd: r.slot_end,
            notes: r.notes,
          }))
        : [];
      const supBookings = !sbRes.error
        ? (
            (sbRes.data ?? []) as {
              id: string;
              slot_start: string;
              slot_end: string;
              customer_name: string | null;
              project_name: string | null;
            }[]
          ).map((r) => ({
            id: r.id,
            slotStart: r.slot_start,
            slotEnd: r.slot_end,
            notes:
              [r.customer_name, r.project_name].filter(Boolean).join(" · ") ||
              null,
          }))
        : [];
      setBookings(
        [...engBookings, ...supBookings].sort((a, b) =>
          a.slotStart.localeCompare(b.slotStart)
        )
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gridStart]);

  const cells = useMemo(
    () =>
      dates.map((d) => {
        const key = toDateInput(d);
        const hol = holidays.find((h) => h.date === key);
        const hasOverride = dateWindows.some((dw) => dw.date === key);
        const hasWindow =
          !hol &&
          (hasOverride || windows.some((w) => w.weekday === d.getDay()));
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
      }),
    [dates, windows, dateWindows, holidays, bookings, todayMid]
  );

  const rangeLabel = useMemo(() => {
    const fmt = (d: Date) =>
      d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${fmt(gridStart)} – ${fmt(addDays(gridStart, 27))}`;
  }, [gridStart]);

  const selectedCell = selectedKey
    ? (cells.find((c) => c.key === selectedKey) ?? null)
    : null;

  return (
    <>
      <section
        className="overflow-hidden rounded-2xl border shadow-sm"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <header
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <CalendarIcon size={13} style={{ color: BRAND_GREEN }} />
          <h2
            className="text-[13px] font-semibold whitespace-nowrap"
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-source-serif)",
            }}
          >
            Next 4 weeks
          </h2>
          <span
            className="text-[11px] whitespace-nowrap"
            style={{ color: "var(--text-muted)" }}
          >
            · {rangeLabel}
          </span>
        </header>

        <div
          className="grid grid-cols-7 border-b px-2 py-1.5 text-[9px] font-semibold tracking-wider uppercase"
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
            className="grid grid-cols-7 gap-px p-2"
            style={{ backgroundColor: "var(--border)" }}
          >
            {cells.map((c) => {
              const bg = c.isHoliday
                ? "color-mix(in srgb, var(--accent-red) 18%, var(--surface))"
                : c.hasWindow
                  ? "color-mix(in srgb, var(--primary) 16%, var(--surface))"
                  : "var(--surface)";
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={c.isPast}
                  onClick={() => setSelectedKey(c.key)}
                  title={
                    c.isHoliday
                      ? `Off${c.holidayLabel ? ` · ${c.holidayLabel}` : ""}`
                      : c.hasWindow
                        ? `Available · ${c.bookings.length} booking${c.bookings.length === 1 ? "" : "s"}`
                        : "Off day"
                  }
                  className="flex min-h-[56px] flex-col items-stretch gap-1 rounded-md border-2 p-1.5 text-left transition-colors hover:brightness-110 disabled:cursor-not-allowed sm:min-h-[72px] sm:p-2"
                  style={{
                    backgroundColor: bg,
                    borderColor: c.isToday ? BRAND_GREEN : "transparent",
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
                  {/* Cell status word — hidden on phones (the cell colour +
                      legend already convey it, and ~46px is too narrow to fit
                      "Available" without breaking mid-word). `truncate` keeps
                      it on one line on larger screens. */}
                  <div
                    className="hidden truncate text-[10px] sm:block"
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
            click any day for details
          </span>
        </div>
      </section>

      {selectedCell && (
        <DayDetailPopup
          date={selectedCell.date}
          isHoliday={selectedCell.isHoliday}
          holidayLabel={selectedCell.holidayLabel}
          hasWindow={selectedCell.hasWindow}
          bookings={selectedCell.bookings}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  );
}

// Read-only day detail — status + that day's bookings. Mutations live in the
// editors below, so this popup never edits.
function DayDetailPopup({
  date,
  isHoliday,
  holidayLabel,
  hasWindow,
  bookings,
  onClose,
}: {
  date: Date;
  isHoliday: boolean;
  holidayLabel: string | null;
  hasWindow: boolean;
  bookings: Booking[];
  onClose: () => void;
}) {
  const dateLabel = date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const status = isHoliday
    ? holidayLabel
      ? `Off · ${holidayLabel}`
      : "Off"
    : hasWindow
      ? "Available"
      : "No availability";
  const statusColor = isHoliday
    ? "var(--accent-red)"
    : hasWindow
      ? "var(--primary)"
      : "var(--text-muted)";
  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-[var(--z-modal)] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2
            className="text-[15px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            {dateLabel}
          </h2>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
              color: statusColor,
            }}
          >
            {status}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
        {bookings.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No scheduled calls.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li
                key={b.id}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="text-[13px] font-medium tabular-nums"
                  style={{ color: "var(--text)" }}
                >
                  {fmtTime(b.slotStart)} – {fmtTime(b.slotEnd)}
                </div>
                {b.notes && (
                  <div
                    className="mt-0.5 text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {b.notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
