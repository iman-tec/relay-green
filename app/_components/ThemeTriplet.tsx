"use client";

/*
 * Three-icon theme switcher — Sun (light) / Moon (dark) / Coffee (espresso).
 *
 * Click any icon to switch to that theme directly (no cycling — each
 * icon is its own destination). The currently-active theme gets a
 * filled-pill background; inactive icons are quiet outlines.
 *
 * Designed to sit next to the Relay wordmark at the top of the customer
 * room sidebar. Compact enough (3 icons × ~20px) to share that row
 * without competing for visual attention.
 */

import { Sun, Moon, Coffee } from "lucide-react";
import { useTheme, type Theme } from "./ThemeProvider";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light",    label: "Light",    Icon: Sun },
  { value: "dark",     label: "Dark",     Icon: Moon },
  { value: "espresso", label: "Espresso", Icon: Coffee },
];

export function ThemeTriplet({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 ${className}`}
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(value)}
            title={label}
            aria-label={`Switch to ${label.toLowerCase()} theme`}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isActive
                ? value === "light"
                  ? "#ffffff"
                  : value === "dark"
                    ? "#0a0a0a"
                    : "#6f4e37" /* espresso */
                : "transparent",
              color: isActive
                ? value === "light"
                  ? "#0a0a0a"
                  : "#ffffff"
                : "var(--text-muted)",
              boxShadow: isActive
                ? "0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(0, 0, 0, 0.06)"
                : "none",
            }}
          >
            <Icon size={13} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
