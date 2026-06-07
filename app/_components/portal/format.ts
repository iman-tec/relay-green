/*
 * Formatting helpers for the Channel Partner command center. Numbers and money
 * are treated as type (tabular), so these return clean strings the UI sets in
 * JetBrains Mono. EUR amounts arrive as integer cents.
 */

const EUR = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const EUR0 = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const INT = new Intl.NumberFormat("en-IE");

const SHORT_DATE = new Intl.DateTimeFormat("en-IE", {
  month: "short",
  day: "numeric",
});

/** €18,940.00 — full precision, for the ribbon + ledger. */
export function eur(cents: number): string {
  return EUR.format((cents ?? 0) / 100);
}

/** €312,400 — rounded, for secondary lifetime figures where cents are noise. */
export function eurCompact(cents: number): string {
  return EUR0.format(Math.round((cents ?? 0) / 100));
}

/** 6,312 — grouped integer (minutes). */
export function int(n: number): string {
  return INT.format(Math.round(n ?? 0));
}

/** "Mar 3" — onboarding dates. Returns an em-dash for null. */
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : SHORT_DATE.format(d);
}

/** "2h ago" / "1d ago" / "3w ago" — last-activity. Em-dash for null. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  const mos = Math.floor(days / 30);
  if (mos < 12) return `${mos}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
