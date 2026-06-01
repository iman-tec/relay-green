"use client";

/*
 * Theme provider — four themes:
 *   - "light"    (sun)         paper-cream + dark ink
 *   - "dark"     (moon)        near-black + cream
 *   - "espresso" (mug)         deep warm brown + cream (coffee mood)
 *   - "klm"      (cloud)       navy→cyan gradient + silver, neon-green accent
 *
 * Persisted in localStorage. A small inline script in app/layout.tsx
 * applies the saved class to <html> before paint, so this provider
 * only handles updates *after* hydration. Also subscribes to cross-tab
 * storage events so opening the same app in a second window stays in
 * sync.
 *
 * DOM contract:
 *   - light    → no class on <html>
 *   - dark     → class="dark"
 *   - espresso → class="espresso"
 *   - klm      → class="klm"
 * (Only one of the optional classes is present at a time.)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  GEO_COOKIE,
  STORAGE_KEY,
  USER_COOKIE,
  normalizeToAppTheme,
  normalizeToGeoTheme,
  type AppTheme,
} from "@/lib/relay/theme";

export type Theme = AppTheme;
// Dark is the app's house default — used only when there is no stored
// preference AND no geo signal at all (e.g. local dev with no Vercel geo
// header). In production the edge proxy always writes a `relay-theme-geo`
// cookie, so geo-unmatched visitors get "cream" (white/sun) per the brief;
// this fallback effectively only covers the no-geo case.
const DEFAULT_THEME: Theme = "dark";

/** Write the cross-surface user-choice cookie so the server, the edge proxy
 *  (override guard), and the pre-paint script all see an explicit manual
 *  choice. Stored in geo/cookie vocab ("light" → "cream"). */
function writeUserThemeCookie(t: Theme): void {
  if (typeof document === "undefined") return;
  const value = normalizeToGeoTheme(t) ?? "cream";
  // 1 year; lax so it rides top-level navigations. Not httpOnly — the
  // client must read it on first paint.
  document.cookie = `${USER_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Legacy 2-theme cycle, retained for callers that only know light/dark.
   *  Cycles between light and dark; does NOT touch espresso. New callers
   *  should prefer setTheme(...) directly. */
  toggleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

function readThemeFromDOM(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const cl = document.documentElement.classList;
  if (cl.contains("dark")) return "dark";
  if (cl.contains("espresso")) return "espresso";
  if (cl.contains("klm")) return "klm";
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial state MUST be identical on the server and on the client's first
  // (hydration) render, or every theme-dependent consumer mismatches and
  // React throws the hydration error (#418) — see RESP-09-1, where the
  // FloatingThemeToggle's icon/aria-label rendered "dark" on the server but
  // the client's resolved theme ("light"/cream for most geos) on hydration.
  //
  // The trap: `readThemeFromDOM()` returns DEFAULT_THEME on the server (no
  // document) but the REAL `<html class>` the pre-paint script applied on the
  // client — so using it as the initializer guarantees divergence whenever
  // the resolved theme isn't DEFAULT_THEME. We therefore seed BOTH renders
  // with the same constant and re-sync from the live DOM in the effect below
  // (one post-hydration state update; the page colours are already correct
  // via the pre-paint script, so only the toggle icon settles after mount).
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // Post-mount re-sync — picks up the class the pre-hydration script
  // applied from localStorage. Runs once; subsequent changes flow
  // through setTheme.
  useEffect(() => {
    const fromDOM = readThemeFromDOM();
    setThemeState((current) => (current === fromDOM ? current : fromDOM));
  }, []);

  const applyTheme = useCallback((t: Theme) => {
    const html = document.documentElement;
    html.classList.remove("dark", "espresso", "klm");
    if (t === "dark") html.classList.add("dark");
    else if (t === "espresso") html.classList.add("espresso");
    else if (t === "klm") html.classList.add("klm");
    // Espresso + klm render dark form controls; light is the only one
    // that asks the UA for a light color-scheme.
    html.style.colorScheme = t === "light" ? "light" : "dark";
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      applyTheme(t);
      // Mirror the choice into BOTH localStorage (this tab / legacy readers)
      // and the cross-surface cookie. The cookie is what lets the server,
      // the marketing surface, and the edge proxy's override-guard honor a
      // manual choice over the geo default.
      try {
        localStorage.setItem(STORAGE_KEY, t);
      } catch {
        // localStorage can throw in private mode / quota errors; ignore,
        // the in-memory state still works for this tab.
      }
      writeUserThemeCookie(t);
    },
    [applyTheme]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = normalizeToAppTheme(e.newValue) ?? "light";
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Outside the provider (e.g. server components) — return a safe
    // no-op so the toggle button can be used anywhere without crashing.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}

/**
 * The pre-hydration script body. Rendered inline in layout.tsx so it runs
 * before any paint — it is what actually puts the theme CLASS on <html>,
 * which globals.css (`:root.dark/.espresso/.klm`) keys off of. Prevents the
 * flash where the page lands in one theme and snaps to another on hydration.
 *
 * Resolution priority (HAND-WRITTEN TWIN of resolveTheme() in
 * lib/relay/theme.ts — keep the two in lock-step; this one can't import the
 * module because it must run before any bundle loads):
 *   1. relay-theme-user cookie   (explicit manual choice, cross-surface)
 *   2. localStorage "relay-theme" (legacy manual choice)
 *   3. relay-theme-geo cookie    (geo default written by the edge proxy)
 *   4. DEFAULT_THEME             (house fallback when no signal at all)
 *
 * "cream" (geo/cookie vocab) maps to "light" (no class).
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    function norm(v) {
      if (!v) return null;
      if (v === "cream") return "light";
      if (v === "light" || v === "dark" || v === "espresso" || v === "klm") return v;
      return null;
    }
    function cookie(name) {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    }
    var theme =
      norm(cookie("${USER_COOKIE}")) ||
      norm(localStorage.getItem("${STORAGE_KEY}")) ||
      norm(cookie("${GEO_COOKIE}")) ||
      "${DEFAULT_THEME}";
    var cl = document.documentElement.classList;
    cl.remove("dark", "espresso", "klm");
    if (theme === "dark") cl.add("dark");
    else if (theme === "espresso") cl.add("espresso");
    else if (theme === "klm") cl.add("klm");
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  } catch (e) {
    /* storage/cookies unavailable; default theme applies via :root */
  }
})();
`.trim();
