/*
 * Deterministic unit tests for the geo-theme logic in lib/relay/theme.ts.
 * No browser / dev server / Supabase needed — run with:
 *
 *   npx tsx scripts/test-geo-theme.ts
 *
 * Exits non-zero on the first failure so it can gate CI / pre-push.
 */

import {
  themeForCountry,
  resolveTheme,
  normalizeToAppTheme,
  normalizeToGeoTheme,
} from "../lib/relay/theme";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(
    `  [${tag}] ${label} => ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`
  );
}

console.log(
  "themeForCountry — espresso (Nordics + Eastern Europe + Middle East)"
);
for (const c of [
  "FI",
  "SE",
  "NO",
  "DK",
  "IS",
  "PL",
  "CZ",
  "HU",
  "RO",
  "UA",
  "EE",
  "LV",
  "LT",
  "RS",
  "HR",
  "AE",
  "SA",
  "QA",
  "BH",
  "IL",
  "EG",
]) {
  check(c, themeForCountry(c), "espresso");
}

console.log("themeForCountry — klm (Benelux + Germany + France)");
for (const c of ["NL", "BE", "LU", "DE", "FR"]) {
  check(c, themeForCountry(c), "klm");
}

console.log("themeForCountry — dark (NA + UK/IE + AUS/NZ + SG)");
for (const c of ["US", "CA", "MX", "GB", "IE", "AU", "NZ", "SG"]) {
  check(c, themeForCountry(c), "dark");
}

console.log("themeForCountry — cream (rest of world + empty/unknown)");
for (const c of ["BR", "JP", "IN", "ZA", "CN", "XX", "", null, undefined]) {
  check(JSON.stringify(c), themeForCountry(c as string), "cream");
}

console.log("themeForCountry — case-insensitive");
check("fi (lowercase)", themeForCountry("fi"), "espresso");
check("fr (lowercase)", themeForCountry("fr"), "klm");

console.log("resolveTheme — priority: user > localStorage > geo > fallback");
check(
  "user wins over ls + geo",
  resolveTheme("dark", "espresso", "klm"),
  "dark"
);
check("ls wins over geo", resolveTheme(null, "espresso", "klm"), "espresso");
check(
  "geo used when no user/ls",
  resolveTheme(null, null, "espresso"),
  "espresso"
);
check("geo cream -> light", resolveTheme(null, null, "cream"), "light");
check("no signal -> dark fallback", resolveTheme(null, null, null), "dark");
check(
  "user cream -> light, beats geo",
  resolveTheme("cream", null, "dark"),
  "light"
);
check(
  "invalid user ignored, geo used",
  resolveTheme("garbage", null, "klm"),
  "klm"
);
check("invalid everywhere -> fallback", resolveTheme("x", "y", "z"), "dark");
check(
  "custom fallback respected",
  resolveTheme(null, null, null, "light"),
  "light"
);

console.log("normalizeToAppTheme / normalizeToGeoTheme bridges");
check("app: cream -> light", normalizeToAppTheme("cream"), "light");
check("app: light -> light", normalizeToAppTheme("light"), "light");
check("app: junk -> null", normalizeToAppTheme("nope"), null);
check("geo: light -> cream", normalizeToGeoTheme("light"), "cream");
check("geo: espresso -> espresso", normalizeToGeoTheme("espresso"), "espresso");
check("geo: null -> null", normalizeToGeoTheme(null), null);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll geo-theme assertions passed.");
