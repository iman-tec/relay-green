"use client";

/*
 * Engineer-panel design kit — used by the Enterprise and Department admin
 * consoles ONLY. These two panels render inside the StaffShell sidebar (like
 * /dashboard and /inbox) and mirror the engineer dashboard's visual language:
 *
 *   - greeting header ("Hi {name}" serif 20px + date line) with a tab strip
 *     styled like the StaffShell sidebar nav (green soft-pill active state)
 *   - rounded-xl cards with 12px uppercase-tracked section headers
 *   - KPI tiles with big serif accent-colored numbers (MonthStatsRow style)
 *   - rounded-md BRAND_GREEN primary buttons
 *
 * Deliberately a fork of _shared.tsx / settingsKit.tsx styling: those files
 * are also imported by the reseller + admin v2 panels, which keep the old
 * look. Don't restyle them in place — restyle here.
 */

import { useEffect, useState, type ReactNode } from "react";

// Same constants the engineer surfaces hardcode (StaffShell, DashboardClient).
export const BRAND_GREEN = "#3f5c2e";
export const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Greeting source — same lookup as the engineer DashboardClient:
 * profiles.full_name → first word; falls back to the email local-part.
 */
export function useFirstName(fallbackEmail: string): string {
  const [name, setName] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sb = (await import("@/lib/supabase/browser")).createClient();
        const { data: u } = await sb.auth.getUser();
        const me = u.user;
        if (!alive || !me) return;
        const { data: prof } = await sb
          .from("profiles")
          .select("full_name")
          .eq("id", me.id)
          .maybeSingle();
        if (!alive) return;
        const full = (prof as { full_name?: string | null } | null)?.full_name;
        const first = full
          ? full.trim().split(/\s+/)[0]
          : (me.email ?? fallbackEmail).split("@")[0];
        if (first) setName(first);
      } catch {
        /* keep email fallback */
      }
    })();
    return () => { alive = false; };
  }, [fallbackEmail]);
  return name || (fallbackEmail.split("@")[0] ?? "");
}

export type PanelTab<T extends string = string> = { key: T; label: string };

/**
 * Panel header — greeting + date (mirrors the engineer DashboardHeader) and,
 * optionally, the panel's tab strip styled like the StaffShell sidebar nav.
 * The enterprise console omits the strip — its tabs live in the StaffShell
 * sidebar as ?tab= links instead.
 */
export function PanelHeader<T extends string>({
  name, subtitle, tabs, active, onChange, rightSlot,
}: {
  name:      string;
  /** Muted text after the date, e.g. "Enterprise console". */
  subtitle?: string;
  /** Omit to render the greeting header without an in-page tab strip. */
  tabs?:     readonly PanelTab<T>[];
  active?:   T;
  onChange?: (next: T) => void;
  rightSlot?: ReactNode;
}) {
  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
  });
  return (
    <header
      className="shrink-0 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto w-full max-w-screen-2xl px-6 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1
              className="text-[20px] font-semibold leading-tight"
              style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
            >
              Hi {name ? capitalize(name) : "there"}
            </h1>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {dateLabel}
              {subtitle ? <span style={{ color: "var(--text-faint)" }}> · {subtitle}</span> : null}
            </p>
          </div>
          {rightSlot && <div className="flex items-center gap-2">{rightSlot}</div>}
        </div>
        {tabs && tabs.length > 0 ? (
          <nav className="mt-3 flex flex-wrap gap-0.5 pb-2" role="tablist">
            {tabs.map((t) => {
              const isActive = t.key === active;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onChange?.(t.key)}
                  className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  style={{
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? BRAND_GREEN : "var(--text)",
                    backgroundColor: isActive ? BRAND_GREEN_SOFT : "transparent",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="pb-5" />
        )}
      </div>
    </header>
  );
}

/** Scroll-safe tab body — engineer dashboard container metrics. */
export function TabBody({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-screen-2xl px-6 py-6">
        {children}
      </div>
    </div>
  );
}

/** Page-level heading inside a tab — subordinate to the greeting h1. */
export function TabTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2
        className="text-lg font-semibold leading-tight"
        style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
      >
        {title}
      </h2>
      {sub ? (
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{sub}</p>
      ) : null}
    </div>
  );
}

/** KPI tile — engineer MonthStatsRow style: big serif accent number. */
export function StatCard({
  value, label, hint, accent = BRAND_GREEN,
}: {
  value: string;
  label: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <span
        className="text-[26px] font-semibold leading-none tabular-nums"
        style={{ color: accent, fontFamily: "var(--font-source-serif)" }}
      >
        {value}
      </span>
      <span className="mt-1 text-[12px] font-medium" style={{ color: "var(--text)" }}>
        {label}
      </span>
      {hint ? (
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{hint}</span>
      ) : null}
    </div>
  );
}

/** Card section header — engineer box-header idiom (uppercase tracked 12px). */
export function CardHeader({
  icon, title, right,
}: {
  icon?: ReactNode;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header
      className="flex items-center gap-2 border-b px-4 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      {icon ? <span style={{ color: "var(--text-faint)" }}>{icon}</span> : null}
      <h3
        className="flex-1 text-[12px] font-semibold tracking-[0.08em] uppercase"
        style={{ color: "var(--text)" }}
      >
        {title}
      </h3>
      {right}
    </header>
  );
}

export type Segment<K extends string> = { key: K; label: string };

/** In-tab segmented switch — sidebar-nav pill style instead of coral pills. */
export function Segmented<K extends string>({
  value, onChange, options, ariaLabel,
}: {
  value: K;
  onChange: (k: K) => void;
  options: readonly Segment<K>[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="mx-auto flex w-full max-w-screen-2xl flex-wrap gap-0.5 px-6 pt-5"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className="rounded-md px-2.5 py-1.5 text-[13px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{
              fontWeight: active ? 600 : 500,
              color: active ? BRAND_GREEN : "var(--text-muted)",
              backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Primary action — engineer CTA style (rounded-md solid brand green). */
export function PrimaryButton({
  onClick, disabled, children, icon, size = "md", title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  size?: "sm" | "md";
  title?: string;
}) {
  const sizing = size === "sm"
    ? "gap-1 px-2.5 py-1.5 text-[11px] font-semibold"
    : "gap-1.5 px-3.5 py-2 text-[13px] font-semibold";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center rounded-md text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${sizing}`}
      style={{ backgroundColor: BRAND_GREEN }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Secondary action — engineer outline style. */
export function OutlineButton({
  onClick, disabled, children, icon, size = "md", title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  size?: "sm" | "md";
  title?: string;
}) {
  const sizing = size === "sm"
    ? "gap-1 px-2.5 py-1.5 text-[11px] font-medium"
    : "gap-1.5 px-3.5 py-2 text-[13px] font-medium";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center rounded-md border transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5 ${sizing}`}
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Settings section card — engineer-styled fork of settingsKit's version
 *  (rounded-xl + uppercase tracked header). Field/toggle/copy rows are
 *  unchanged and re-exported below. */
export function SettingsSection({
  icon, title, desc, children, accent,
}: {
  icon?: ReactNode; title: string; desc?: string; children: ReactNode; accent?: boolean;
}) {
  return (
    <section
      className="rounded-xl border p-5"
      style={{
        borderColor: accent ? BRAND_GREEN : "var(--border)",
        background: accent ? BRAND_GREEN_SOFT : "var(--surface)",
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        {icon ? <span style={{ color: accent ? BRAND_GREEN : "var(--text-faint)" }}>{icon}</span> : null}
        <h2
          className="text-[12px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: "var(--text)" }}
        >
          {title}
        </h2>
      </div>
      {desc ? <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>{desc}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

export { EditableField, CopyRow, SettingsToggle, IdentityBlock } from "./settingsKit";
