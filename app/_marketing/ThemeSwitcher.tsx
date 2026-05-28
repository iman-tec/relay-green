"use client";

/*
 * Theme picker for the marketing site (lives in the top nav).
 *
 * Four palette options:
 *   - Sun       → cream (default/white)
 *   - Moon      → dark (black & grey)
 *   - Coffee    → espresso (warm brown-black)
 *   - Cloud     → klm (KLM blue gradient with silver headings)
 *
 * Applies the choice in TWO places so both surfaces stay in sync:
 *   1. `data-theme="..."` on `.mk-root` — re-skins the marketing
 *      sections via rules in marketing.css.
 *   2. matching class on `<html>` — re-skins non-marketing pages
 *      (/login, /set-password, …) via rules in globals.css. This is
 *      what makes the sign-in card pick up the visitor's marketing
 *      theme instead of falling back to the app default.
 *
 * Choice persists in BOTH localStorage and the cross-surface
 * `relay-theme-user` cookie (so the server, the geo proxy, and the
 * pre-paint script all honor it). On mount it resolves the active icon
 * with the same priority as the rest of the app — user cookie > localStorage
 * > geo cookie > cream — so it never clobbers the geo theme the server
 * already rendered onto `.mk-root`. First-paint FOUC is handled server-side
 * (Shell sets `.mk-root[data-theme]`) + by the inline script in layout.tsx.
 */

import { useEffect, useState } from "react";

import {
  GEO_COOKIE,
  STORAGE_KEY,
  USER_COOKIE,
  normalizeToGeoTheme,
  type GeoTheme,
} from "@/lib/relay/theme";

type Theme = GeoTheme;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeUserThemeCookie(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.cookie = `${USER_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

function applyTheme(theme: Theme) {
  // 1. Marketing surface — .mk-root data attribute
  const root = document.querySelector(".mk-root");
  if (root) {
    if (theme === "cream") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }

  // 2. App surface — class on <html>. "cream" is the app's "light"
  // (no class). Keeping both names in localStorage; the app's pre-
  // hydration script in layout.tsx maps "cream" → "light" on read.
  const html = document.documentElement;
  html.classList.remove("dark", "espresso", "klm");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "espresso") html.classList.add("espresso");
  else if (theme === "klm") html.classList.add("klm");
  html.style.colorScheme = theme === "cream" ? "light" : "dark";
}

/* Inline SVG icons — 18px viewBox, currentColor strokes so they inherit
 * the nav link color and adapt to whichever theme is active. */
function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function MugIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Cup body */}
      <path d="M4 9h12v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9Z" />
      {/* Handle on the right */}
      <path d="M16 11h2a2.5 2.5 0 0 1 0 5h-2" />
      {/* Steam */}
      <path d="M8 2c0 1.5 1.5 1.5 1.5 3S8 6.5 8 8" />
      <path d="M12 2c0 1.5 1.5 1.5 1.5 3S12 6.5 12 8" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 0 0 4.5 11a4.5 4.5 0 0 0 .5 8h12.5Z" />
    </svg>
  );
}

const THEMES: Array<{
  id: Theme;
  label: string;
  Icon: () => React.ReactElement;
}> = [
  { id: "cream", label: "Cream theme (sun)", Icon: SunIcon },
  { id: "dark", label: "Black & grey theme (moon)", Icon: MoonIcon },
  { id: "espresso", label: "Espresso theme (mug)", Icon: MugIcon },
  { id: "klm", label: "KLM blue theme (cloud)", Icon: CloudIcon },
];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("cream");

  useEffect(() => {
    // Resolve with the same priority as the rest of the app so this mount
    // effect does NOT clobber the geo theme the server already rendered onto
    // `.mk-root` (which would happen if we blindly read localStorage and
    // defaulted to "cream"). Priority: user cookie > localStorage > geo
    // cookie > cream.
    const userCookie = normalizeToGeoTheme(readCookie(USER_COOKIE));
    const stored = normalizeToGeoTheme(localStorage.getItem(STORAGE_KEY));
    const geoCookie = normalizeToGeoTheme(readCookie(GEO_COOKIE));
    const resolved: Theme = userCookie ?? stored ?? geoCookie ?? "cream";

    // Backfill the cross-surface cookie for legacy visitors who only have a
    // localStorage choice — keeps SSR + proxy honoring it from now on.
    if (!userCookie && stored) writeUserThemeCookie(stored);

    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage may be blocked; theme still applies for the session */
    }
    writeUserThemeCookie(next);
  }

  return (
    <div
      role="group"
      aria-label="Background theme"
      className="r-theme-switcher"
    >
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => choose(t.id)}
            aria-pressed={active}
            aria-label={t.label}
            title={t.label}
            className={"r-theme-icon" + (active ? " active" : "")}
          >
            <t.Icon />
          </button>
        );
      })}
    </div>
  );
}
