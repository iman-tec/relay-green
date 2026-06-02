/*
 * Shared timezone-picker data + helpers for the booking modals.
 *
 * Mirrors the inline implementation that ships in SupervisorScheduleModal so
 * the engineer-booking modal can present the same searchable "GMT±h · City"
 * dropdown (search by country, city, or offset). Kept framework-agnostic —
 * the consuming component owns the dropdown markup.
 */

export type TzOption = { tz: string; label: string; search: string };

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
// matches a country name even though zone IDs are region/city based.
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
export function tzOffsetMs(timeZone: string, date: Date): number {
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

// "GMT+5:30" from an offset in minutes.
export function fmtOffset(mins: number): string {
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60),
    mm = abs % 60;
  return `GMT${sign}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

export function cityOf(tz: string): string {
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

// Build the full option list (detected zone first, then sorted west→east),
// each carrying a search string that folds in any country names mapping to it.
export function buildTzOptions(): TzOption[] {
  const at = new Date();
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
  return opts;
}

export function filterTzOptions(
  options: TzOption[],
  query: string
): TzOption[] {
  const q = query.trim().toLowerCase();
  return q ? options.filter((o) => o.search.includes(q)) : options;
}
