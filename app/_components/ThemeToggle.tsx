"use client";

/*
 * Theme toggle — sun/moon button that flips between light and dark.
 *
 * Two variants:
 *   <ThemeToggle />          → icon-only, square. For dense headers.
 *   <ThemeToggle showLabel /> → icon + "Light" / "Dark" label. For
 *                              roomier surfaces like the staff sidebar.
 *
 * Reads from useTheme(); the provider handles persistence and applying
 * the class to <html>.
 */

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({
  showLabel = false,
  className = "",
}: {
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label  = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${className}`}
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {showLabel && (
        <span style={{ color: "var(--text-muted)" }}>
          {isDark ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
}
