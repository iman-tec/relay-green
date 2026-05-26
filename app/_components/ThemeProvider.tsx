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

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "espresso" | "klm";

const STORAGE_KEY = "relay-theme";
// Dark is the new house default — most app surfaces feel right against
// a dark canvas + the bright Relay green. First-visit users without a
// stored preference land in dark; the Sun/Moon/Coffee triplet in the
// sidebar lets them switch.
const DEFAULT_THEME: Theme = "dark";

/** Marketing's ThemeSwitcher writes "cream" to localStorage for the
 *  default sun palette — we use "light" for the same thing. Map on
 *  read so a marketing-selected theme actually applies on /login. */
function normalizeStoredTheme(raw: string | null): Theme | null {
  if (!raw) return null;
  if (raw === "cream") return "light";
  if (raw === "light" || raw === "dark" || raw === "espresso" || raw === "klm") {
    return raw;
  }
  return null;
}

type Ctx = {
  theme:       Theme;
  setTheme:    (t: Theme) => void;
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
  // SSR can't read the DOM, so initial server state always falls back to
  // DEFAULT_THEME. The matching client-side useState initializer would
  // hydrate to the same value to avoid mismatch warnings, but that
  // leaves React's state diverged from the actual `<html class="…">`
  // the pre-hydration script applied from localStorage. After mount we
  // re-sync by reading the live DOM (see useEffect below).
  const [theme, setThemeState] = useState<Theme>(() => readThemeFromDOM());

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

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // localStorage can throw in private mode / quota errors; ignore,
      // the in-memory state still works for this tab.
    }
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = normalizeStoredTheme(e.newValue) ?? "light";
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
 * The pre-hydration script body. Keep this in lock-step with STORAGE_KEY
 * / DEFAULT_THEME / the 3-theme set above. Rendered inline in layout.tsx
 * so it runs before any paint — prevents the brief flash where the page
 * lands in one theme and snaps to another on hydration.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem("${STORAGE_KEY}");
    // Marketing writes "cream" for the default sun palette; treat it as light.
    if (saved === "cream") saved = "light";
    var theme = (saved === "dark" || saved === "light" || saved === "espresso" || saved === "klm") ? saved : "${DEFAULT_THEME}";
    var cl = document.documentElement.classList;
    cl.remove("dark", "espresso", "klm");
    if (theme === "dark") cl.add("dark");
    else if (theme === "espresso") cl.add("espresso");
    else if (theme === "klm") cl.add("klm");
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  } catch (e) {
    /* localStorage unavailable; default theme applies via :root */
  }
})();
`.trim();
