"use client";

/*
 * Design kit for the Enterprise + Department admin consoles.
 *
 * Visuals are aligned 1:1 with the Channel Partner panel (the reference):
 * every value here mirrors _shared.tsx / settingsKit.tsx / the reference
 * tabs (rounded-2xl cards, token coral accents, serif page titles,
 * pill filter chips, rounded-full CTAs matching app/_components/ui/Button).
 *
 * Component APIs are unchanged — _kit is imported ONLY by the enterprise +
 * department panels, never by the Channel Partner panel, so restyling here
 * cannot affect the reference console.
 */

import { useEffect, useState, type ReactNode } from "react";

// Sidebar-rail active palette — same constants StaffShell and
// ResellerSidebar hardcode (ResellerSidebar.tsx:43-44), used only for the
// rail-style chrome that mirrors the sidebars.
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
 * Panel header — greeting + date and, optionally, an in-page tab strip.
 * Title typography matches the reference page titles
 * (PartnerDashboardTab.tsx:72-79); the tab pills match the reference
 * filter-chip idiom (ClientsTab.tsx:280-291).
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
    <>
      {/* Single compact row — py-2.5 (20px) + the 32px text-2xl line puts
          the bottom border at 53px, flush with the StaffShell sidebar
          header divider (px-3 py-3 + h-7 content = 52px + 1px border,
          StaffShell.tsx:575). Full-width (no centered max-w container) so
          the rightSlot (notification bell) sits at the absolute right. */}
      <header
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h1
            className="font-serif text-2xl font-medium leading-8"
            style={{ color: "var(--text)" }}
          >
            Hi {name ? capitalize(name) : "there"}
          </h1>
          <p className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
            {dateLabel}
            {subtitle ? <span style={{ color: "var(--text-faint)" }}> · {subtitle}</span> : null}
          </p>
        </div>
        {rightSlot && (
          <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
        )}
      </header>
      {/* Tab strip lives BELOW the bordered row so the divider line stays a
          single, sidebar-aligned hairline on every panel. */}
      {tabs && tabs.length > 0 ? (
        <nav className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-4 sm:px-6" role="tablist">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange?.(t.key)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: isActive ? "var(--primary)" : "var(--border)",
                  background: isActive ? "var(--primary-tint)" : "transparent",
                  color: isActive ? "var(--primary-hover)" : "var(--text-muted)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}

/** Scroll-safe tab body — same container metrics as the reference
 *  (_shared.tsx:101-109). */
export function TabBody({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </div>
  );
}

/** Page-level heading inside a tab — reference page-title idiom
 *  (PartnerDashboardTab.tsx:72-79, PartnerSettingsTab.tsx:283-291). */
export function TabTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2
        className="font-serif text-2xl font-medium"
        style={{ color: "var(--text)" }}
      >
        {title}
      </h2>
      {sub ? (
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>{sub}</p>
      ) : null}
    </div>
  );
}

/** Stat card — icon chip + big serif number + caption. Mirrors the
 *  reference StatCard exactly (_shared.tsx:56-98). */
export function StatCard({
  icon, value, label, hint,
}: {
  icon?: ReactNode;
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] p-4 transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md sm:p-5"
      style={{ background: "var(--surface)" }}
    >
      {icon ? (
        <div className="flex items-center justify-between">
          <span
            className="inline-flex size-9 items-center justify-center rounded-xl"
            style={{
              background: "var(--primary-tint)",
              color: "var(--primary-hover)",
            }}
          >
            {icon}
          </span>
        </div>
      ) : null}
      <div
        className="font-serif text-2xl font-medium tabular-nums sm:text-3xl"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
        {hint ? (
          <span style={{ color: "var(--text-faint)" }}> · {hint}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Card section header — reference card-header idiom: title left
 *  (text-sm semibold), muted icon right (PartnerDashboardTab.tsx:110-121). */
export function CardHeader({
  icon, title, right,
}: {
  icon?: ReactNode;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header
      className="flex items-center justify-between border-b px-4 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </h3>
      <div className="flex items-center gap-2">
        {right}
        {icon ? <span style={{ color: "var(--text-muted)" }}>{icon}</span> : null}
      </div>
    </header>
  );
}

export type Segment<K extends string> = { key: K; label: string };

/** In-tab segmented switch — reference filter-chip idiom
 *  (ClientsTab.tsx:280-291, InvitationsView.tsx:163-168). */
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
      className="mx-auto flex w-full max-w-screen-xl flex-wrap gap-1.5 px-4 pt-5 sm:px-6"
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
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderColor: active ? "var(--primary)" : "var(--border)",
              background: active ? "var(--primary-tint)" : "transparent",
              color: active ? "var(--primary-hover)" : "var(--text-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Primary action — visually matches app/_components/ui/Button's primary
 *  variant (Button.tsx:51-60), the button the reference panel uses. */
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
    ? "h-9 gap-1.5 px-3 text-sm"
    : "h-11 gap-2 px-4 text-[15px]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center rounded-full border border-transparent bg-[var(--primary)] font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-55 ${sizing}`}
    >
      {icon}
      <span className="inline-flex items-center">{children}</span>
    </button>
  );
}

/** Secondary action — visually matches ui/Button's secondary variant
 *  (Button.tsx:61-62). */
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
    ? "h-9 gap-1.5 px-3 text-sm"
    : "h-11 gap-2 px-4 text-[15px]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-raised)] font-medium text-[var(--text)] transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-55 ${sizing}`}
    >
      {icon}
      <span className="inline-flex items-center">{children}</span>
    </button>
  );
}

// Settings building blocks come straight from settingsKit — the exact
// components the Channel Partner settings screen renders
// (PartnerSettingsTab.tsx:294), so the targets' settings cards are
// pixel-identical to the reference by construction.
export {
  SettingsSection,
  EditableField,
  CopyRow,
  SettingsToggle,
  IdentityBlock,
} from "./settingsKit";
