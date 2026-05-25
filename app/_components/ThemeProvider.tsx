"use client";

/*
 * Theme provider — three themes:
 *   - "light"    (default)     paper-cream + dark ink
 *   - "dark"                   near-black + cream
 *   - "espresso"               deep warm brown + cream (coffee mood)
 *
 * Persisted in localStorage. A small inline script in app/layout.tsx
 * applies the saved class to <html> before paint, so this provider
 * only handles updates *after* hydration. Also subscribes to cross-tab
 * storage events so opening the same app in a second window stays in
 * sync.
 *
 * DOM contract:
 *   - light  → no class on <html>
 *   - dark   → class="dark"
 *   - espresso → class="espresso"
 * (Only one of the optional classes is present at a time.)
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "espresso";

const STORAGE_KEY = "relay-theme";
// Dark is the new house default — most app surfaces feel right against
// a dark canvas + the bright Relay green. First-visit users without a
// stored preference land in dark; the Sun/Moon/Coffee triplet in the
// sidebar lets them switch.
const DEFAULT_THEME: Theme = "dark";

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
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the class already applied by the pre-hydration script so the
  // first React render matches the DOM and avoids hydration mismatch.
  const [theme, setThemeState] = useState<Theme>(() => readThemeFromDOM());

  const applyTheme = useCallback((t: Theme) => {
    const html = document.documentElement;
    html.classList.remove("dark", "espresso");
    if (t === "dark") html.classList.add("dark");
    else if (t === "espresso") html.classList.add("espresso");
    html.style.colorScheme = t === "espresso" ? "dark" : t;
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
      const next: Theme =
        e.newValue === "dark"     ? "dark"
        : e.newValue === "espresso" ? "espresso"
        : "light";
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
    var theme = (saved === "dark" || saved === "light" || saved === "espresso") ? saved : "${DEFAULT_THEME}";
    var cl = document.documentElement.classList;
    cl.remove("dark", "espresso");
    if (theme === "dark") cl.add("dark");
    else if (theme === "espresso") cl.add("espresso");
    document.documentElement.style.colorScheme = theme === "espresso" ? "dark" : theme;
  } catch (e) {
    /* localStorage unavailable; default theme applies via :root */
  }
})();
`.trim();
