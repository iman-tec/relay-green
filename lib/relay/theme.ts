/*
 * Single source of truth for theme logic — shared by the edge proxy
 * (geo → theme), the server layout/Shell (cookie → first-paint attribute),
 * and the client switchers + pre-hydration script (resolve which theme to
 * apply before paint).
 *
 * Two vocabularies exist for historical reasons and are bridged here:
 *   - "Geo / cookie / marketing" vocab: cream | dark | espresso | klm
 *     ("cream" = the default white/sun palette). Used in cookies and on
 *     `.mk-root[data-theme]`.
 *   - "App / class" vocab: light | dark | espresso | klm ("light" = the
 *     same default palette, expressed as the *absence* of a class on
 *     <html>). Used by globals.css `:root.dark/.espresso/.klm`.
 *
 * cream <-> light are the same palette; normalize on every boundary.
 *
 * This module is intentionally dependency-free (no Next.js / React imports)
 * so it can run in the edge proxy AND be unit-tested in plain Node via tsx.
 */

export type GeoTheme = "cream" | "dark" | "espresso" | "klm";
export type AppTheme = "light" | "dark" | "espresso" | "klm";

export const STORAGE_KEY = "relay-theme";
export const USER_COOKIE = "relay-theme-user";
export const GEO_COOKIE = "relay-theme-geo";

/*
 * ISO 3166-1 alpha-2 country code → theme. Anything not listed falls
 * through to "cream" (default white/sun). Grouping mirrors the product
 * brief:
 *   - Espresso (coffee mug): Nordics + Eastern Europe + Middle East
 *   - Cloud / KLM (blue):     Benelux + Germany + France
 *   - Moon (black):           North America + UK/IE + Australia/NZ + SG
 *   - Sun (white/cream):      rest of world
 */
export const COUNTRY_TO_THEME: Record<string, GeoTheme> = {
  // --- Espresso ---------------------------------------------------------
  // Nordics
  SE: "espresso",
  NO: "espresso",
  DK: "espresso",
  FI: "espresso",
  IS: "espresso",
  // Eastern Europe (incl. Baltics + Western Balkans). Adjust this set to
  // taste — "Eastern Europe" is a judgement call; these are the mainstream
  // members.
  PL: "espresso",
  CZ: "espresso",
  SK: "espresso",
  HU: "espresso",
  RO: "espresso",
  BG: "espresso",
  EE: "espresso",
  LV: "espresso",
  LT: "espresso",
  UA: "espresso",
  BY: "espresso",
  MD: "espresso",
  RU: "espresso",
  SI: "espresso",
  HR: "espresso",
  RS: "espresso",
  BA: "espresso",
  ME: "espresso",
  MK: "espresso",
  AL: "espresso",
  XK: "espresso",
  // Middle East
  AE: "espresso",
  SA: "espresso",
  QA: "espresso",
  KW: "espresso",
  BH: "espresso",
  OM: "espresso",
  IL: "espresso",
  JO: "espresso",
  LB: "espresso",
  EG: "espresso",

  // --- Cloud (KLM) ------------------------------------------------------
  // Benelux + Germany + France
  NL: "klm",
  BE: "klm",
  LU: "klm",
  DE: "klm",
  FR: "klm",

  // --- Moon (dark) ------------------------------------------------------
  US: "dark",
  CA: "dark",
  MX: "dark",
  GB: "dark",
  IE: "dark",
  AU: "dark",
  NZ: "dark",
  SG: "dark",
};

/** Map a (possibly empty / unknown) ISO country code to its geo theme. */
export function themeForCountry(country: string | null | undefined): GeoTheme {
  if (!country) return "cream";
  return COUNTRY_TO_THEME[country.toUpperCase()] ?? "cream";
}

/** Normalize any stored value (either vocabulary) to the app/class vocab. */
export function normalizeToAppTheme(
  raw: string | null | undefined
): AppTheme | null {
  if (!raw) return null;
  if (raw === "cream") return "light";
  if (
    raw === "light" ||
    raw === "dark" ||
    raw === "espresso" ||
    raw === "klm"
  ) {
    return raw;
  }
  return null;
}

/** Normalize any stored value (either vocabulary) to the geo/cookie vocab. */
export function normalizeToGeoTheme(
  raw: string | null | undefined
): GeoTheme | null {
  if (!raw) return null;
  if (raw === "light") return "cream";
  if (
    raw === "cream" ||
    raw === "dark" ||
    raw === "espresso" ||
    raw === "klm"
  ) {
    return raw;
  }
  return null;
}

/**
 * Resolve which theme to apply, in priority order:
 *   1. explicit user choice (cross-surface cookie)
 *   2. legacy localStorage choice (manual choice made before the cookie
 *      existed — keep honoring it so returning users don't get reset)
 *   3. geo default (set by the edge proxy)
 *   4. fallback (the app's house default — dark)
 *
 * Returns the app/class vocabulary ("light" for the default palette).
 *
 * KEEP IN LOCK-STEP with the inline pre-paint script in ThemeProvider.tsx
 * (THEME_INIT_SCRIPT) — that script is a hand-written browser twin of this
 * function because it must run before any bundle loads.
 */
export function resolveTheme(
  userCookie: string | null | undefined,
  localStorageValue: string | null | undefined,
  geoCookie: string | null | undefined,
  fallback: AppTheme = "dark"
): AppTheme {
  return (
    normalizeToAppTheme(userCookie) ??
    normalizeToAppTheme(localStorageValue) ??
    normalizeToAppTheme(geoCookie) ??
    fallback
  );
}
