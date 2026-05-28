/*
 * End-to-end browser proof of the geo-theme chain:
 *   x-vercel-ip-country header → edge proxy → relay-theme-geo cookie →
 *   inline THEME_INIT_SCRIPT → class on <html> → globals.css palette.
 *
 * Drives headless Chromium with a spoofed country header (the only way to
 * exercise the real first-paint path). Point it at the running dev server:
 *
 *   BASE_URL=http://localhost:PORT node scripts/e2e-geo-theme.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const cases = [
  { country: "FI", expect: "espresso", label: "Finland → espresso (coffee)" },
  { country: "SE", expect: "espresso", label: "Sweden → espresso (coffee)" },
  { country: "PL", expect: "espresso", label: "Poland → espresso (E. Europe)" },
  { country: "AE", expect: "espresso", label: "UAE → espresso (Middle East)" },
  { country: "FR", expect: "klm", label: "France → klm (cloud)" },
  { country: "DE", expect: "klm", label: "Germany → klm (cloud)" },
  { country: "GB", expect: "dark", label: "UK → dark (moon)" },
  { country: "US", expect: "dark", label: "USA → dark (moon)" },
  { country: "AU", expect: "dark", label: "Australia → dark (moon)" },
  { country: "BR", expect: "light", label: "Brazil → light/cream (sun)" },
];

function classToTheme(cls) {
  if (/\bespresso\b/.test(cls)) return "espresso";
  if (/\bklm\b/.test(cls)) return "klm";
  if (/\bdark\b/.test(cls)) return "dark";
  return "light";
}

let failures = 0;
const browser = await chromium.launch();

async function themeFor(country, { userCookie, viewport } = {}) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "x-vercel-ip-country": country },
    ...(viewport ? { viewport } : {}),
  });
  if (userCookie) {
    await ctx.addCookies([
      { name: "relay-theme-user", value: userCookie, url: BASE },
    ]);
  }
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const cls = await page.evaluate(() => document.documentElement.className);
  const cookies = await ctx.cookies();
  const geo =
    cookies.find((c) => c.name === "relay-theme-geo")?.value ?? "(none)";
  await ctx.close();
  return { theme: classToTheme(cls), geo };
}

console.log(`Geo-theme browser checks against ${BASE}/login\n`);

for (const c of cases) {
  const { theme, geo } = await themeFor(c.country);
  const ok = theme === c.expect;
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${c.label.padEnd(34)} <html>=${theme.padEnd(8)} geo-cookie=${geo}`
  );
}

// Manual user choice must beat the geo default.
{
  const { theme } = await themeFor("FI", { userCookie: "dark" });
  const ok = theme === "dark";
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${"Manual 'dark' overrides FI geo".padEnd(34)} <html>=${theme}`
  );
}

// Mobile viewport sanity (375px) — theme must apply identically.
{
  const { theme } = await themeFor("FI", {
    viewport: { width: 375, height: 812 },
  });
  const ok = theme === "espresso";
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${"Mobile 375px: FI → espresso".padEnd(34)} <html>=${theme}`
  );
}

// Marketing surface (homepage): .mk-root[data-theme] (server-rendered) AND
// the nav switcher's active icon must both reflect geo. Tests the "icon on
// the top palette" the brief refers to.
{
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "x-vercel-ip-country": "FR" },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Wait for the post-hydration effect to move the active icon off the
  // initial "cream" default to the geo-resolved one (cloud for FR).
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector(
          '.r-theme-switcher [aria-pressed="true"]'
        );
        return !!el && /cloud/i.test(el.getAttribute("aria-label") || "");
      },
      { timeout: 8000 }
    )
    .catch(() => {});
  const data = await page.evaluate(() => ({
    mkRoot:
      document.querySelector(".mk-root")?.getAttribute("data-theme") ??
      "(none)",
    html: document.documentElement.className,
    activeIcon:
      document
        .querySelector('.r-theme-switcher [aria-pressed="true"]')
        ?.getAttribute("aria-label") ?? "(none)",
  }));
  await ctx.close();
  const okRoot = data.mkRoot === "klm";
  const okIcon = /cloud/i.test(data.activeIcon);
  if (!okRoot || !okIcon) failures++;
  console.log(
    `[${okRoot && okIcon ? "PASS" : "FAIL"}] ${"Marketing home FR → cloud".padEnd(34)} .mk-root=${data.mkRoot} activeIcon="${data.activeIcon}"`
  );
}

await browser.close();
if (failures) {
  console.error(`\n${failures} browser check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll browser geo-theme checks passed.");
