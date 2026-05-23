"use client";

/*
 * Theme provider — light (default) ↔ dark, persisted in localStorage.
 *
 * A small inline script in app/layout.tsx applies the saved class to
 * <html> before paint, so this provider only handles updates *after*
 * hydration. It also subscribes to cross-tab storage events so opening
 * the same app in a second window stays in sync.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "relay-theme";
const DEFAULT_THEME: Theme = "light";

type Ctx = {
  theme:       Theme;
  setTheme:    (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the class already applied by the pre-hydration script so the
  // first React render matches the DOM and avoids hydration mismatch.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return DEFAULT_THEME;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  const applyTheme = useCallback((t: Theme) => {
    const html = document.documentElement;
    if (t === "dark") html.classList.add("dark");
    else              html.classList.remove("dark");
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
      const next = e.newValue === "dark" ? "dark" : "light";
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
 * The pre-hydration script body. Keep this in lock-step with
 * STORAGE_KEY / DEFAULT_THEME above. Rendered inline in layout.tsx so
 * it runs before any paint — prevents the brief flash where the page
 * lands light and then snaps to dark (or vice versa) on load.
 *
 * Exported as a string so layout.tsx can drop it into
 * dangerouslySetInnerHTML without us re-implementing the logic.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem("${STORAGE_KEY}");
    var theme = (saved === "dark" || saved === "light") ? saved : "${DEFAULT_THEME}";
    if (theme === "dark") document.documentElement.classList.add("dark");
    else                  document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    /* localStorage unavailable; default theme applies via :root */
  }
})();
`.trim();
