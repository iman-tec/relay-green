/*
 * Theme-aware Stripe Elements appearance.
 *
 * Stripe Elements run inside an iframe — the appearance API does NOT
 * resolve CSS variables. We have to read the literal computed colours
 * off `:root` at the time the Elements provider mounts and pass them as
 * concrete hex strings. When the user flips the theme toggle the
 * caller should remount Elements (e.g. `<Elements key={theme} ... />`)
 * so this helper re-runs with the new tokens.
 *
 * Maps to the design tokens in app/globals.css:
 *   --primary, --primary-soft, --surface, --surface-raised, --border,
 *   --text, --text-muted, --text-faint, --risk
 */

import type { Appearance } from "@stripe/stripe-js";

type ResolvedTokens = {
  primary:       string;
  primarySoft:   string;
  surface:       string;
  surfaceRaised: string;
  border:        string;
  text:          string;
  textMuted:     string;
  textFaint:     string;
  danger:        string;
};

const LIGHT_FALLBACK: ResolvedTokens = {
  primary:       "#16a34a",
  primarySoft:   "rgba(22, 163, 74, 0.12)",
  surface:       "#ffffff",
  surfaceRaised: "#f1f4f3",
  border:        "#e6eae8",
  text:          "#14171a",
  textMuted:     "#5b6470",
  textFaint:     "#8a939d",
  danger:        "#dc2626",
};

const DARK_FALLBACK: ResolvedTokens = {
  primary:       "#22c55e",
  primarySoft:   "rgba(34, 197, 94, 0.18)",
  surface:       "#1c1f23",
  surfaceRaised: "#232830",
  border:        "#2a2f35",
  text:          "#f5f7fa",
  textMuted:     "#98a1ac",
  textFaint:     "#6c7682",
  danger:        "#ef4444",
};

function resolveTokens(): { theme: "light" | "dark"; tokens: ResolvedTokens } {
  if (typeof document === "undefined") {
    return { theme: "light", tokens: LIGHT_FALLBACK };
  }
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const fallback = isDark ? DARK_FALLBACK : LIGHT_FALLBACK;
  const cs = getComputedStyle(root);

  const pick = (varName: string, fb: string): string => {
    const v = cs.getPropertyValue(varName).trim();
    return v || fb;
  };

  return {
    theme: isDark ? "dark" : "light",
    tokens: {
      primary:       pick("--primary",        fallback.primary),
      primarySoft:   pick("--primary-soft",   fallback.primarySoft),
      surface:       pick("--surface",        fallback.surface),
      surfaceRaised: pick("--surface-raised", fallback.surfaceRaised),
      border:        pick("--border",         fallback.border),
      text:          pick("--text",           fallback.text),
      textMuted:     pick("--text-muted",     fallback.textMuted),
      textFaint:     pick("--text-faint",     fallback.textFaint),
      danger:        pick("--risk",           fallback.danger),
    },
  };
}

/**
 * Build a Stripe Elements `Appearance` object that matches the current
 * `.dark` / light state of the document. Call this at the moment you
 * pass `appearance` into <Elements options={...} />, and remount
 * Elements when the theme toggles (key={theme}).
 */
export function buildStripeAppearance(): Appearance {
  const { theme, tokens } = resolveTokens();

  return {
    theme:  theme === "dark" ? "night" : "stripe",
    labels: "floating",
    variables: {
      colorPrimary:         tokens.primary,
      colorBackground:      tokens.surface,
      colorText:            tokens.text,
      colorTextSecondary:   tokens.textMuted,
      colorTextPlaceholder: tokens.textFaint,
      colorDanger:          tokens.danger,
      fontFamily:           "Inter, system-ui, -apple-system, sans-serif",
      borderRadius:         "10px",
      spacingUnit:          "4px",
    },
    rules: {
      ".Input": {
        backgroundColor: tokens.surface,
        border:          `1px solid ${tokens.border}`,
        color:           tokens.text,
      },
      ".Input:focus": {
        borderColor: tokens.primary,
        boxShadow:   `0 0 0 3px ${tokens.primarySoft}`,
      },
      ".Input--invalid": {
        borderColor: tokens.danger,
      },
      ".Label": {
        color: tokens.textMuted,
      },
      ".Tab, .Block": {
        backgroundColor: tokens.surface,
        border:          `1px solid ${tokens.border}`,
      },
      ".Tab:hover": {
        borderColor: tokens.primary,
      },
      ".Tab--selected, .Tab--selected:focus": {
        borderColor:     tokens.primary,
        backgroundColor: tokens.surfaceRaised,
        boxShadow:       `0 0 0 1px ${tokens.primary}`,
      },
      ".TabIcon--selected": {
        fill: tokens.primary,
      },
    },
  };
}
