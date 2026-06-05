"use client";

/*
 * Coverage planner — a heatmap of how many pod engineers are available per
 * hour across the next N days (weekly pattern minus holidays), plus a list of
 * zero-coverage gap bands inside operating hours. Helps the supervisor see
 * "is anyone about to be left waiting?" a week or month ahead.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CalendarRange,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { Card, EmptyState as UiEmptyState } from "@/app/_components/ui";

type Day = {
  date: string;
  weekday: number;
  coverageByHour: number[];
  bookings: number;
  gaps: { startHour: number; endHour: number }[];
};
type Coverage = {
  days: number;
  openHour: number;
  closeHour: number;
  engineerCount: number;
  calendar: Day[];
};

const RANGES = [7, 14, 30] as const;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CoveragePanel() {
  const [range, setRange] = useState<number>(7);
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supervisor/coverage?days=${days}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Coverage & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Couldn't load coverage.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load coverage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const hours = data
    ? Array.from(
        { length: data.closeHour - data.openHour },
        (_, i) => data.openHour + i
      )
    : [];
  const daysWithGaps = data?.calendar.filter((d) => d.gaps.length > 0) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className="flex items-center gap-2 text-sm font-semibold"
          style={{ color: "var(--text)" }}
        >
          <CalendarRange size={16} /> Coverage planner
        </h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: range === r ? "var(--primary)" : "var(--border)",
                background: range === r ? "var(--primary-tint)" : "transparent",
                color:
                  range === r ? "var(--primary-hover)" : "var(--text-muted)",
              }}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2
            size={20}
            className="animate-spin"
            style={{ color: "var(--text-muted)" }}
          />
        </div>
      ) : error ? (
        <Card variant="hollow" className="border-dashed">
          <div className="p-6">
            <UiEmptyState compact title="Couldn't load coverage" body={error} />
          </div>
        </Card>
      ) : !data || data.engineerCount === 0 ? (
        <Card variant="hollow" className="border-dashed">
          <div className="p-6">
            <UiEmptyState
              compact
              title="No coverage to plan"
              body="No engineers in your pod, or no availability set."
            />
          </div>
        </Card>
      ) : (
        <>
          {/* Gap summary */}
          <Card variant="surface" className="p-4">
            <div
              className="mb-2 flex items-center gap-2 text-sm font-semibold"
              style={{
                color: daysWithGaps.length ? "var(--risk)" : "var(--ok)",
              }}
            >
              <AlertTriangle size={15} />{" "}
              {daysWithGaps.length === 0
                ? "No coverage gaps in the next " + data.days + " days"
                : `${daysWithGaps.length} day${daysWithGaps.length === 1 ? "" : "s"} with gaps`}
            </div>
            {daysWithGaps.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {daysWithGaps.map((d) => (
                  <li key={d.date} style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--text)" }}>
                      {DOW[d.weekday]} {fmtDate(d.date)}
                    </span>
                    {" · "}
                    {d.gaps
                      .map((g) => `${pad(g.startHour)}:00–${pad(g.endHour)}:00`)
                      .join(", ")}{" "}
                    uncovered
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Heatmap */}
          <Card variant="surface" className="overflow-x-auto p-4">
            <table
              className="w-full border-separate"
              style={{ borderSpacing: "2px" }}
            >
              <thead>
                <tr>
                  <th
                    className="sticky left-0 px-1 text-left text-[10px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Day
                  </th>
                  {hours.map((h) => (
                    <th
                      key={h}
                      className="text-[10px] font-medium tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {pad(h)}
                    </th>
                  ))}
                  <th
                    className="px-1 text-[10px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Bk
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.calendar.map((d) => (
                  <tr key={d.date}>
                    <td
                      className="px-1 text-[11px] whitespace-nowrap"
                      style={{ color: "var(--text)" }}
                    >
                      {DOW[d.weekday]} {fmtDate(d.date)}
                    </td>
                    {hours.map((h) => {
                      const c = d.coverageByHour[h];
                      return (
                        <td key={h}>
                          <div
                            className="h-5 w-full min-w-[14px] rounded-[3px]"
                            title={`${pad(h)}:00 · ${c} engineer${c === 1 ? "" : "s"}`}
                            style={cell(c)}
                          />
                        </td>
                      );
                    })}
                    <td
                      className="px-1 text-center text-[11px] tabular-nums"
                      style={{
                        color: d.bookings ? "var(--text)" : "var(--text-faint)",
                      }}
                    >
                      {d.bookings || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              className="mt-3 flex items-center gap-3 text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              <span>Coverage:</span>
              <Legend c={0} label="gap" />
              <Legend c={1} label="1" />
              <Legend c={2} label="2" />
              <Legend c={4} label="3+" />
              <span className="ml-2">Bk = bookings</span>
            </div>
          </Card>

          <BookingsList />
        </>
      )}
    </div>
  );
}

// ── C2: bookings org-view ──────────────────────────────────────────────────
type Booking = {
  id: string;
  engineer: string;
  engineerId: string;
  customer: string;
  project: string | null;
  slotStart: string;
  slotEnd: string;
  status: string;
};

function BookingsList() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [eng, setEng] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/supervisor/bookings", {
          cache: "no-store",
        });
        if (res.ok && alive)
          setRows(
            ((await res.json()) as { bookings: Booking[] }).bookings ?? []
          );
      } catch {
        /* transient fetch failure — ignore, leave list empty */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const engineers = useMemo(
    () => [...new Map(rows.map((r) => [r.engineerId, r.engineer])).entries()],
    [rows]
  );
  const filtered = eng ? rows.filter((r) => r.engineerId === eng) : rows;

  return (
    <Card variant="surface" className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3
          className="flex items-center gap-2 text-sm font-semibold"
          style={{ color: "var(--text)" }}
        >
          <CalendarClock size={15} /> Bookings{" "}
          <span
            className="text-xs font-normal"
            style={{ color: "var(--text-muted)" }}
          >
            ({filtered.length})
          </span>
        </h3>
        {engineers.length > 1 && (
          <select
            value={eng}
            onChange={(e) => setEng(e.target.value)}
            className="h-8 rounded-md border px-2 text-xs"
            style={{
              borderColor: "var(--border)",
              background: "var(--background)",
              color: "var(--text)",
            }}
          >
            <option value="">All engineers</option>
            {engineers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <div
          className="flex items-center gap-2 py-4 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          No upcoming bookings.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {filtered.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-2 border-t py-2 text-xs first:border-t-0"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="w-32 shrink-0 tabular-nums"
                style={{ color: "var(--text)" }}
              >
                {fmtSlot(b.slotStart)}
              </span>
              <span
                className="min-w-0 flex-1 truncate"
                style={{ color: "var(--text)" }}
              >
                {b.customer}
                {b.project ? (
                  <span style={{ color: "var(--text-faint)" }}>
                    {" "}
                    · {b.project}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
                {b.engineer}
              </span>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase"
                style={{
                  color:
                    b.status === "booked"
                      ? "var(--primary-hover)"
                      : "var(--text-muted)",
                  background: "color-mix(in srgb, var(--text) 6%, transparent)",
                }}
              >
                {b.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function fmtSlot(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cell(count: number): React.CSSProperties {
  if (count === 0)
    return { background: "color-mix(in srgb, var(--risk) 22%, transparent)" };
  const intensity = Math.min(count / 3, 1);
  return {
    background: `color-mix(in srgb, var(--primary) ${Math.round(20 + intensity * 70)}%, transparent)`,
  };
}
function Legend({ c, label }: { c: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-3 rounded-[3px]" style={cell(c)} />
      {label}
    </span>
  );
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
