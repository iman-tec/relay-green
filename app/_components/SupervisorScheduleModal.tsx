"use client";

/*
 * Customer-side modal for booking a 30-minute appointment with the supervisor
 * who owns a bid. Triggered from Contract management → "Ask for appointment".
 *
 * Which supervisor? Resolved server-side by supervisor_for_quote(quoteId):
 * bid → project → projects.last_eng_connected → that engineer's pod →
 * the pod's supervisor. The customer can't traverse pod_members under RLS, so
 * the RPC (SECURITY DEFINER) hands back just the supervisor's user_id, which we
 * use to read the (role-agnostic) engineer_availability_windows the supervisor
 * publishes through the shared CalendarTab.
 *
 * Layout: month calendar (left) + time-slot list (right), like a standard
 * booking page. Availability windows are stored in the SUPERVISOR's IANA zone;
 * we materialise each 30-minute slot into a real UTC instant once, then DISPLAY
 * + group them in whatever zone the customer picks (default: their device zone,
 * switchable via the dropdown). Slots step every 15 minutes (each runs 30 min)
 * and start no sooner than ~1h from now (the ≥4-slot lead). Slots already taken
 * by any customer are hidden via supervisor_busy_slots.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  Loader2,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Video,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Window = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
};
type DateOverride = { date: string; startMinute: number; endMinute: number };
type Busy = { start: number; end: number }; // epoch ms
type Slot = { start: Date; end: Date };
type TzOption = { tz: string; label: string; search: string };

const SLOT_MIN = 30; // appointment length
const GRID_MIN = 15; // start-time granularity
const LEAD_MIN = 4 * GRID_MIN; // ≥4 slots ahead (~1h) before the first bookable slot
const MAX_WORKING_DAYS = 10; // customer can book into the next 10 days that have slots
const DAYS_AHEAD = 30; // calendar-day search ceiling (wide enough to find 10 working days)
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Fallback zone list if the runtime lacks Intl.supportedValuesOf (older
// browsers). The live app pulls the full ~400-zone IANA list at runtime.
const TZ_FALLBACK = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Paris",
  "Europe/Athens",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

// Country (and common alias) → representative IANA zone(s), so the search box
// matches a country name even though zone IDs are region/city based. Folded
// into each zone's search text. Multi-zone countries list their main zones.
const COUNTRY_TZ: Record<string, string[]> = {
  "united states": [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Phoenix",
  ],
  usa: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
  ],
  america: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
  ],
  "united kingdom": ["Europe/London"],
  uk: ["Europe/London"],
  britain: ["Europe/London"],
  england: ["Europe/London"],
  scotland: ["Europe/London"],
  ireland: ["Europe/Dublin"],
  india: ["Asia/Kolkata"],
  china: ["Asia/Shanghai"],
  japan: ["Asia/Tokyo"],
  germany: ["Europe/Berlin"],
  france: ["Europe/Paris"],
  canada: [
    "America/Toronto",
    "America/Vancouver",
    "America/Edmonton",
    "America/Winnipeg",
    "America/Halifax",
  ],
  australia: [
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Perth",
    "Australia/Adelaide",
  ],
  brazil: ["America/Sao_Paulo", "America/Manaus"],
  russia: [
    "Europe/Moscow",
    "Asia/Yekaterinburg",
    "Asia/Novosibirsk",
    "Asia/Vladivostok",
  ],
  mexico: ["America/Mexico_City", "America/Tijuana", "America/Monterrey"],
  italy: ["Europe/Rome"],
  spain: ["Europe/Madrid"],
  netherlands: ["Europe/Amsterdam"],
  holland: ["Europe/Amsterdam"],
  sweden: ["Europe/Stockholm"],
  norway: ["Europe/Oslo"],
  denmark: ["Europe/Copenhagen"],
  finland: ["Europe/Helsinki"],
  poland: ["Europe/Warsaw"],
  portugal: ["Europe/Lisbon"],
  switzerland: ["Europe/Zurich"],
  austria: ["Europe/Vienna"],
  belgium: ["Europe/Brussels"],
  "czech republic": ["Europe/Prague"],
  czechia: ["Europe/Prague"],
  hungary: ["Europe/Budapest"],
  romania: ["Europe/Bucharest"],
  greece: ["Europe/Athens"],
  turkey: ["Europe/Istanbul"],
  ukraine: ["Europe/Kyiv"],
  iceland: ["Atlantic/Reykjavik"],
  uae: ["Asia/Dubai"],
  "united arab emirates": ["Asia/Dubai"],
  emirates: ["Asia/Dubai"],
  "saudi arabia": ["Asia/Riyadh"],
  qatar: ["Asia/Qatar"],
  kuwait: ["Asia/Kuwait"],
  israel: ["Asia/Jerusalem"],
  iran: ["Asia/Tehran"],
  iraq: ["Asia/Baghdad"],
  pakistan: ["Asia/Karachi"],
  bangladesh: ["Asia/Dhaka"],
  "sri lanka": ["Asia/Colombo"],
  nepal: ["Asia/Kathmandu"],
  indonesia: ["Asia/Jakarta"],
  thailand: ["Asia/Bangkok"],
  vietnam: ["Asia/Ho_Chi_Minh"],
  philippines: ["Asia/Manila"],
  malaysia: ["Asia/Kuala_Lumpur"],
  singapore: ["Asia/Singapore"],
  "south korea": ["Asia/Seoul"],
  korea: ["Asia/Seoul"],
  "north korea": ["Asia/Pyongyang"],
  "hong kong": ["Asia/Hong_Kong"],
  taiwan: ["Asia/Taipei"],
  "new zealand": ["Pacific/Auckland"],
  "south africa": ["Africa/Johannesburg"],
  egypt: ["Africa/Cairo"],
  nigeria: ["Africa/Lagos"],
  kenya: ["Africa/Nairobi"],
  ghana: ["Africa/Accra"],
  morocco: ["Africa/Casablanca"],
  ethiopia: ["Africa/Addis_Ababa"],
  tanzania: ["Africa/Dar_es_Salaam"],
  argentina: ["America/Argentina/Buenos_Aires"],
  chile: ["America/Santiago"],
  colombia: ["America/Bogota"],
  peru: ["America/Lima"],
  venezuela: ["America/Caracas"],
  ecuador: ["America/Guayaquil"],
  bolivia: ["America/La_Paz"],
  uruguay: ["America/Montevideo"],
  paraguay: ["America/Asuncion"],
  "puerto rico": ["America/Puerto_Rico"],
  "costa rica": ["America/Costa_Rica"],
  panama: ["America/Panama"],
  guatemala: ["America/Guatemala"],
  cuba: ["America/Havana"],
};

// Offset (ms) between a wall-clock time in `timeZone` and UTC at `date`.
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour === 24 ? 0 : +map.hour,
    +map.minute,
    +map.second
  );
  return asUTC - date.getTime();
}

// Convert a wall-clock time (y, mo[0-11], d, minutes-from-midnight) expressed in
// `timeZone` into the real UTC instant. Two-pass to settle across DST edges.
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  minutes: number,
  timeZone: string
): Date {
  const hh = Math.floor(minutes / 60),
    mm = minutes % 60;
  const guess = Date.UTC(y, mo, d, hh, mm);
  let off = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - off;
  off = tzOffsetMs(timeZone, new Date(utc));
  utc = guess - off;
  return new Date(utc);
}

// The y/mo/d of `date` as seen in `timeZone`.
function ymdInZone(
  timeZone: string,
  date: Date
): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return { y: +map.year, mo: +map.month - 1, d: +map.day };
}

const keyOf = (y: number, mo: number, d: number) =>
  `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const monthOf = (key: string): { y: number; mo: number } => {
  const [y, m] = key.split("-").map(Number);
  return { y, mo: m - 1 };
};

// The yyyy-mm-dd calendar day a UTC instant falls on, in `tz`.
function dayKeyInTz(d: Date, tz: string): string {
  const { y, mo, d: dd } = ymdInZone(tz, d);
  return keyOf(y, mo, dd);
}

// "Tuesday, 2 Jun" from a yyyy-mm-dd key (rendered tz-neutrally at UTC noon).
function dayLabelFromKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// 24-hour start time in the chosen zone, e.g. "09:00".
function fmtSlot(d: Date, tz: string): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// "GMT+5:30" from an offset in minutes.
function fmtOffset(mins: number): string {
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60),
    mm = abs % 60;
  return `GMT${sign}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

function cityOf(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

// The full IANA zone list when available (modern browsers), else the fallback.
function allZones(): string[] {
  const sv = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  if (typeof sv === "function") {
    try {
      return sv.call(Intl, "timeZone");
    } catch {
      /* fall through */
    }
  }
  return TZ_FALLBACK;
}

// 6-week (42-cell) grid starting on the Monday on/before the 1st.
function monthGrid(
  y: number,
  mo: number
): { d: number; key: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(y, mo, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Mon = 0
  const start = new Date(Date.UTC(y, mo, 1 - startDow));
  const cells: { d: number; key: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    const cy = dt.getUTCFullYear(),
      cmo = dt.getUTCMonth(),
      cd = dt.getUTCDate();
    cells.push({
      d: cd,
      key: keyOf(cy, cmo, cd),
      inMonth: cmo === mo && cy === y,
    });
  }
  return cells;
}

// Build the flat, sorted list of bookable 30-minute slots over the horizon.
// Pure given a fixed `nowMs` (snapshotted in the effect so render stays pure).
// Weekday windows resolve in the SUPERVISOR's calendar; each slot becomes a UTC
// instant. Display/grouping zone is applied later.
function buildSlots(
  windows: Window[],
  holidayKeys: Set<string>,
  overridesByDate: Map<string, DateOverride[]>,
  busy: Busy[],
  tz: string,
  nowMs: number
): Slot[] {
  const out: Slot[] = [];
  if (windows.length === 0) return out;
  const earliest = nowMs + LEAD_MIN * 60_000;

  const today = ymdInZone(tz, new Date(nowMs));
  const cursor = new Date(Date.UTC(today.y, today.mo, today.d, 12, 0, 0));

  // Stop after the first MAX_WORKING_DAYS days that actually have bookable
  // slots (the supervisor's working days), not after a fixed calendar span.
  let workingDays = 0;
  for (let i = 0; i < DAYS_AHEAD && workingDays < MAX_WORKING_DAYS; i++) {
    const y = cursor.getUTCFullYear(),
      mo = cursor.getUTCMonth(),
      d = cursor.getUTCDate();
    const dayKey = keyOf(y, mo, d);
    const weekday = new Date(Date.UTC(y, mo, d)).getUTCDay();

    const daySlots: Slot[] = [];
    if (!holidayKeys.has(dayKey)) {
      const overrides = overridesByDate.get(dayKey);
      const dayWindows =
        overrides && overrides.length > 0
          ? overrides
          : windows.filter((w) => w.weekday === weekday);

      for (const w of dayWindows) {
        for (
          let m = w.startMinute;
          m + SLOT_MIN <= w.endMinute;
          m += GRID_MIN
        ) {
          const start = zonedToUtc(y, mo, d, m, tz);
          const startMs = start.getTime();
          if (startMs < earliest) continue;
          const endMs = startMs + SLOT_MIN * 60_000;
          if (busy.some((b) => b.start < endMs && b.end > startMs)) continue;
          daySlots.push({ start, end: new Date(endMs) });
        }
      }
    }
    if (daySlots.length > 0) {
      out.push(...daySlots);
      workingDays++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

export function SupervisorScheduleModal({
  quoteId,
  projectName,
  onClose,
  onBooked,
  replaceBookingId = null,
}: {
  quoteId: string;
  projectName: string;
  onClose: () => void;
  onBooked: (booking: { slotStart: string; slotEnd: string }) => void;
  /** When set, booking a slot reschedules (cancels) this existing booking. */
  replaceBookingId?: string | null;
}) {
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [hasWindows, setHasWindows] = useState(true);
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<{ y: number; mo: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noSupervisor, setNoSupervisor] = useState(false);
  const [booking, setBooking] = useState(false);

  const [customerTz, setCustomerTz] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  // Calendly-style confirm step (matches ScheduleEngineerModal): clicking a
  // time arms it; only the green Confirm actually books.
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);
  const [tzOptions, setTzOptions] = useState<TzOption[]>([]);
  const [tzOpen, setTzOpen] = useState(false);
  const [tzQuery, setTzQuery] = useState("");
  const tzRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = createClient();

        const { data: supId, error: supErr } = await sb.rpc(
          "supervisor_for_quote",
          { _quote_id: quoteId }
        );
        if (!alive) return;
        if (supErr) throw new Error(supErr.message);
        if (!supId) {
          setNoSupervisor(true);
          setLoading(false);
          return;
        }

        const from = new Date();
        const to = new Date(from);
        to.setDate(to.getDate() + DAYS_AHEAD + 1);

        const [wRes, hRes, dwRes, busyRes] = await Promise.all([
          sb
            .from("engineer_availability_windows")
            .select("weekday, start_minute, end_minute, timezone")
            .eq("engineer_user_id", supId),
          sb
            .from("engineer_holidays")
            .select("holiday_date")
            .eq("engineer_user_id", supId)
            .gte("holiday_date", from.toISOString().slice(0, 10))
            .lt("holiday_date", to.toISOString().slice(0, 10)),
          sb
            .from("engineer_date_windows")
            .select("the_date, start_minute, end_minute")
            .eq("engineer_user_id", supId)
            .gte("the_date", from.toISOString().slice(0, 10))
            .lt("the_date", to.toISOString().slice(0, 10)),
          sb.rpc("supervisor_busy_slots", {
            _supervisor_user_id: supId,
            _from: from.toISOString(),
            _to: to.toISOString(),
          }),
        ]);
        if (!alive) return;
        if (wRes.error) throw new Error(wRes.error.message);

        const windows: Window[] = (
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
        }));
        const holidayKeys = new Set<string>(
          (!hRes.error && hRes.data
            ? (hRes.data as Array<{ holiday_date: string }>)
            : []
          ).map((r) => r.holiday_date)
        );
        const overridesByDate = new Map<string, DateOverride[]>();
        for (const r of !dwRes.error && dwRes.data
          ? (dwRes.data as Array<{
              the_date: string;
              start_minute: number;
              end_minute: number;
            }>)
          : []) {
          const arr = overridesByDate.get(r.the_date) ?? [];
          arr.push({
            date: r.the_date,
            startMinute: r.start_minute,
            endMinute: r.end_minute,
          });
          overridesByDate.set(r.the_date, arr);
        }
        const busy: Busy[] = (
          !busyRes.error && busyRes.data
            ? (busyRes.data as Array<{ slot_start: string; slot_end: string }>)
            : []
        ).map((r) => ({
          start: new Date(r.slot_start).getTime(),
          end: new Date(r.slot_end).getTime(),
        }));
        const tz = windows[0]?.timezone ?? "UTC";

        setHasWindows(windows.length > 0);
        setAllSlots(
          buildSlots(
            windows,
            holidayKeys,
            overridesByDate,
            busy,
            tz,
            Date.now()
          )
        );

        // Zone switcher list (full IANA set + live offsets), sorted west→east.
        // Detected zone read fresh (not from state) so this effect never depends
        // on customerTz. Each option carries a search string that folds in any
        // country names mapping to it, so the search box matches "india" etc.
        const at = new Date();
        const detected =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const zoneCountries: Record<string, string[]> = {};
        for (const [country, zs] of Object.entries(COUNTRY_TZ)) {
          for (const z of zs) (zoneCountries[z] ??= []).push(country);
        }
        const offCache = new Map<string, number>();
        const offOf = (z: string) => {
          let v = offCache.get(z);
          if (v === undefined) {
            v = Math.round(tzOffsetMs(z, at) / 60000);
            offCache.set(z, v);
          }
          return v;
        };
        const seen = new Set<string>();
        const opts: TzOption[] = [];
        for (const z of [detected, ...allZones()]) {
          if (seen.has(z)) continue;
          seen.add(z);
          const off = fmtOffset(offOf(z));
          const extra = (zoneCountries[z] ?? []).join(" ");
          opts.push({
            tz: z,
            label: `${off} · ${cityOf(z)}`,
            search: `${z} ${off} ${extra}`.toLowerCase().replace(/[_/]/g, " "),
          });
        }
        opts.sort((a, b) => offOf(a.tz) - offOf(b.tz));
        setTzOptions(opts);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't load the supervisor's calendar."
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [quoteId]);

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

  // Group slots by the SELECTED zone's calendar day — switching the zone
  // re-buckets days + relabels times without refetching.
  const slotsByDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of allSlots) {
      const k = dayKeyInTz(s.start, customerTz);
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return m;
  }, [allSlots, customerTz]);
  const dayKeys = useMemo(() => [...slotsByDay.keys()].sort(), [slotsByDay]);

  // Effective selection without a set-state-in-effect: fall back to the first
  // available day whenever the current pick isn't valid for the chosen zone.
  const effectiveDayKey =
    activeDayKey && slotsByDay.has(activeDayKey)
      ? activeDayKey
      : (dayKeys[0] ?? null);
  const activeSlots =
    (effectiveDayKey && slotsByDay.get(effectiveDayKey)) || [];

  // Calendar month (derived; defaults to the first available month).
  const firstKey = dayKeys[0];
  const lastKey = dayKeys[dayKeys.length - 1];
  const view = viewMonth ?? (firstKey ? monthOf(firstKey) : null);
  const cells = useMemo(() => (view ? monthGrid(view.y, view.mo) : []), [view]);
  const idx = (m: { y: number; mo: number }) => m.y * 12 + m.mo;
  const canPrev = !!view && !!firstKey && idx(view) > idx(monthOf(firstKey));
  const canNext = !!view && !!lastKey && idx(view) < idx(monthOf(lastKey));
  const shiftMonth = (delta: number) => {
    if (!view) return;
    const n = view.y * 12 + view.mo + delta;
    setViewMonth({ y: Math.floor(n / 12), mo: ((n % 12) + 12) % 12 });
  };
  const monthLabel = view
    ? new Date(Date.UTC(view.y, view.mo, 1)).toLocaleDateString([], {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  const selectedTzLabel = useMemo(
    () =>
      tzOptions.find((o) => o.tz === customerTz)?.label ?? cityOf(customerTz),
    [tzOptions, customerTz]
  );
  const filteredTz = useMemo(() => {
    const q = tzQuery.trim().toLowerCase();
    return q ? tzOptions.filter((o) => o.search.includes(q)) : tzOptions;
  }, [tzOptions, tzQuery]);

  const submitBooking = async (slot: Slot) => {
    setBooking(true);
    setError(null);
    try {
      const sb = createClient();
      const { error: rpcErr } = await sb.rpc("book_supervisor_slot", {
        _quote_id: quoteId,
        _slot_start: slot.start.toISOString(),
        _slot_end: slot.end.toISOString(),
        _notes: null,
        _replace_id: replaceBookingId ?? null,
      });
      if (rpcErr) throw new Error(friendlyError(rpcErr.message));
      // Refresh the sidebar pill + center view immediately.
      window.dispatchEvent(new Event("relay:scheduled-changed"));
      onBooked({
        slotStart: slot.start.toISOString(),
        slotEnd: slot.end.toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the slot.");
      setBooking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-6"
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl border shadow-xl"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
          maxHeight: "min(90vh, 620px)",
        }}
      >
        {/* Calendly-style chrome (matches ScheduleEngineerModal): no
            full-width header — the left info pane owns the identity;
            close floats top-right. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
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
        ) : noSupervisor ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: "var(--text)" }}>
              No supervisor is available for this bid yet.
            </p>
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              The team will reach out — please try again shortly.
            </p>
          </div>
        ) : !hasWindows ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: "var(--text)" }}>
              No availability has been published yet.
            </p>
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              Please check back soon.
            </p>
          </div>
        ) : dayKeys.length === 0 ? (
          <div
            className="px-5 py-12 text-center text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            No open slots available right now.
          </div>
        ) : (
          <div className="flex max-h-full min-h-0 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
            {/* LEFT — supervisor / event info (Calendly's host pane). */}
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
              <div className="mt-3 flex items-center gap-3 sm:mt-4 sm:block">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "var(--primary-soft)",
                    color: "var(--primary)",
                  }}
                  aria-hidden
                >
                  <CalendarIcon size={18} />
                </div>
                <div className="min-w-0">
                  <div
                    className="truncate text-[12.5px] sm:mt-2"
                    style={{ color: "var(--text-muted)" }}
                    title={projectName}
                  >
                    {projectName}
                  </div>
                  <h2
                    className="mt-0.5 text-[17px] leading-snug font-semibold"
                    style={{
                      color: "var(--text)",
                      fontFamily: "var(--font-source-serif)",
                    }}
                  >
                    {replaceBookingId
                      ? "Change appointment"
                      : "Supervisor call"}
                  </h2>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 sm:block">
                <div
                  className="flex items-center gap-2 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Clock size={13} className="shrink-0" />
                  30 min
                </div>
                <div
                  className="flex items-center gap-2 text-[12px] sm:mt-1.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Video size={13} className="shrink-0" />
                  Zoom
                </div>
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
                  onClick={() => shiftMonth(-1)}
                  disabled={!canPrev}
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
                  {monthLabel}
                </span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  disabled={!canNext}
                  aria-label="Next month"
                  className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-30"
                  style={{ color: "var(--text)" }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="pb-1 text-center text-[10px] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {w}
                  </div>
                ))}
                {cells.map((cell, i) => {
                  const selectable = cell.inMonth && slotsByDay.has(cell.key);
                  const selected = cell.key === effectiveDayKey;
                  return (
                    <button
                      key={`${cell.key}-${i}`}
                      type="button"
                      disabled={!selectable}
                      onClick={() => {
                        setActiveDayKey(cell.key);
                        setPendingSlot(null);
                      }}
                      className="flex aspect-square items-center justify-center rounded-full text-[13px] transition-colors"
                      style={{
                        color: selected
                          ? "#fff"
                          : selectable
                            ? "var(--primary)"
                            : cell.inMonth
                              ? "var(--text-faint)"
                              : "transparent",
                        // Calendly treatment: bookable days wear a soft
                        // tinted circle; the selected day is filled.
                        backgroundColor: selected
                          ? "var(--primary)"
                          : selectable
                            ? "var(--primary-soft)"
                            : "transparent",
                        fontWeight: selectable ? 600 : 400,
                        cursor: selectable ? "pointer" : "default",
                      }}
                    >
                      {cell.d}
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
                    // calendar pane, so a downward menu gets clipped by
                    // the modal's overflow-hidden shell.
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
                          const sel = o.tz === customerTz;
                          return (
                            <button
                              key={o.tz}
                              type="button"
                              role="option"
                              aria-selected={sel}
                              onClick={() => {
                                setCustomerTz(o.tz);
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
                Clicking a time arms it; only the green Confirm books. */}
            <div className="flex min-w-0 flex-col p-5 sm:w-[230px] sm:shrink-0">
              <div
                className="mb-3 text-[13px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                {effectiveDayKey
                  ? dayLabelFromKey(effectiveDayKey)
                  : "Pick a date"}
              </div>
              <div className="min-h-[160px] flex-1 sm:max-h-[420px] sm:overflow-y-auto">
                <div className="flex flex-col gap-1.5 pr-0.5">
                  {activeSlots.map((s) => {
                    const timeLabel = fmtSlot(s.start, customerTz);
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

function friendlyError(raw: string): string {
  if (raw.includes("SLOT_UNAVAILABLE"))
    return "That slot was just taken — please pick another.";
  if (raw.includes("SLOT_TOO_SOON"))
    return "That slot is too soon — please pick a later time.";
  if (raw.includes("NO_SUPERVISOR_FOR_QUOTE"))
    return "No supervisor is available for this bid yet.";
  return "Couldn't book the slot. Please try another time.";
}
