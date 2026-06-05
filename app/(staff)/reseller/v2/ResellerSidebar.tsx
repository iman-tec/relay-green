"use client";

/*
 * Channel Partner sidebar — left-nav rail that mirrors the engineer/customer
 * shell (app/_components/StaffShell.tsx) so the partner console feels like
 * the rest of the product rather than the top-tab admin panels.
 *
 * Deliberately tab-driven (not route-driven): the reseller panel keeps its
 * single /reseller/v2 route + tab state, so the nav items flip `tab` state
 * via onChange rather than navigating. This preserves the existing
 * ?tab=… deep-linking handled in PanelClient.
 *
 * Layout, mirroring StaffShell:
 *   - Collapsible (272px open / 60px collapsed), persisted to localStorage.
 *   - Top: wordmark (dot-only when collapsed) + collapse toggle.
 *   - Middle: icon-first nav (Dashboard / Clients / Settings); active item
 *     gets the brand-green tint, same as StaffShell.
 *   - Bottom: notification bell, theme triplet, and a profile chip whose
 *     dropdown carries Sign out.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
  Coffee,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { useTheme, type Theme } from "@/app/_components/ThemeProvider";
import { createClient } from "@/lib/supabase/browser";

// Same brand-green active-state palette StaffShell uses for its nav, so the
// partner rail is visually identical to the engineer/customer one.
const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

const SIDEBAR_OPEN_W = 272;
const SIDEBAR_CLOSED_W = 60;
const COLLAPSED_KEY = "relay.reseller.sidebar.collapsed";

export type ResellerTabKey = "dashboard" | "clients" | "settings";

type NavItem = {
  key: ResellerTabKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};

const NAV: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "clients", label: "Enterprises", icon: Building2 },
  { key: "settings", label: "Settings", icon: Settings },
];

export function ResellerSidebar({
  active,
  onChange,
  me,
}: {
  active: ResellerTabKey;
  onChange: (next: ResellerTabKey) => void;
  me: { email: string; roleLabel: string };
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Below `lg` the rail behaves as an overlay drawer (see render notes). We
  // track the breakpoint so we can (a) default to collapsed on small screens
  // and (b) auto-close the drawer after a section is picked.
  const [isNarrow, setIsNarrow] = useState(false);

  // Track the narrow breakpoint with matchMedia (kept in sync on resize /
  // orientation change). 1023px = one below Tailwind's `lg` (1024px).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Initial collapse decision. On a narrow screen always start collapsed so
  // content is visible (the drawer overlays only when the user opens it). On
  // wide screens honour the persisted preference.
  useEffect(() => {
    try {
      if (window.matchMedia("(max-width: 1023px)").matches) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
        return;
      }
      if (localStorage.getItem(COLLAPSED_KEY) === "1") {
        setCollapsed(true);
      }
    } catch {
      /* localStorage / matchMedia unavailable — keep default */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      // Only persist the preference on wide screens — on mobile the collapsed
      // state is an ephemeral open/closed drawer, not a layout preference.
      try {
        if (!window.matchMedia("(max-width: 1023px)").matches) {
          localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Section select — closes the overlay drawer afterwards on narrow screens so
  // the chosen tab's content is immediately visible.
  const selectTab = useCallback(
    (key: ResellerTabKey) => {
      onChange(key);
      if (isNarrow) setCollapsed(true);
    },
    [onChange, isNarrow]
  );

  return (
    <>
      {/* Dimming backdrop — mobile/tablet only, shown while the drawer is open.
          Tapping it closes the drawer. Hidden at `lg`+ where the rail is
          in-flow. */}
      {!collapsed && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        /*
         * Below `lg`: `fixed` overlay drawer pinned to the left edge — it sits
         * ON TOP of the content (which keeps its place behind the backdrop)
         * instead of shrinking it. The collapsed rail (60px) still shows so the
         * toggle stays reachable; expanding grows it to 272px over the content.
         * At `lg`+: an in-flow (`static`) flex rail that shares row width with
         * the content, exactly as before.
         */
        className="fixed inset-y-0 left-0 z-40 flex h-full shrink-0 flex-col border-r shadow-xl transition-[width] duration-200 ease-out lg:static lg:z-auto lg:shadow-none"
        style={{
          width: collapsed ? SIDEBAR_CLOSED_W : SIDEBAR_OPEN_W,
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        {/* Top (expanded): wordmark + theme + collapse toggle */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-3">
            <button
              type="button"
              onClick={() => selectTab("dashboard")}
              className="flex items-center no-underline"
              aria-label="Channel Partner home"
              title="Channel Partner"
            >
              <Wordmark size="md" />
            </button>
            <span className="flex-1" />
            <ThemeMenu collapsed={false} />
            <button
              type="button"
              onClick={toggle}
              className="rounded-md p-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              aria-label="Collapse sidebar"
              style={{ color: "var(--text-muted)" }}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        )}

        {/* Top (collapsed): expand toggle + theme, centered — mirrors the
            customer-module rail (no brand dot). */}
        {collapsed && (
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={toggle}
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              aria-label="Expand sidebar"
              style={{ color: "var(--text-muted)" }}
            >
              <PanelLeftOpen size={18} />
            </button>
            <ThemeMenu collapsed />
          </div>
        )}

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectTab(item.key)}
                title={collapsed ? item.label : undefined}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors"
                style={{
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? BRAND_GREEN : "var(--text)",
                  backgroundColor: isActive ? BRAND_GREEN_SOFT : "transparent",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <Icon size={16} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
          <div className="flex-1" />
        </nav>

        {/* Bottom: profile chip (theme switcher lives at the top now) */}
        <div
          className="mb-4 border-t px-2 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <ProfileButton
            email={me.email}
            roleLabel={me.roleLabel}
            collapsed={collapsed}
          />
        </div>
      </aside>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

// Compact theme switcher — shows ONLY the active theme's icon as a single
// button. Hovering (or clicking, for touch) reveals the full ThemeTriplet so
// the user can pick light / dark / espresso. Lives at the top of the rail next
// to the collapse toggle. The popover opens downward when expanded and to the
// right when the rail is collapsed, so it never clips off-screen.
// Partial map — covers the three themes ThemeTriplet offers; any other theme
// (e.g. a brand theme) falls back to the Sun glyph on the trigger button.
const THEME_ICON: Partial<Record<Theme, typeof Sun>> = {
  light: Sun,
  dark: Moon,
  espresso: Coffee,
};

function ThemeMenu({ collapsed }: { collapsed: boolean }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ActiveIcon = THEME_ICON[theme] ?? Sun;

  // Close on outside click (covers the click-to-open path on touch devices,
  // where there's no mouseleave).
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-expanded={open}
        title="Change theme"
        className="flex h-6 w-6 items-center justify-center rounded-full border transition-colors"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text-muted)",
        }}
      >
        <ActiveIcon size={13} strokeWidth={2} />
      </button>
      {open && (
        // No margin gap between the trigger and the popover — the visual
        // spacing comes from inner padding so the hover area stays contiguous
        // (a margin gap would fire mouseleave and close it before the pointer
        // reached the options).
        <div
          className="absolute z-50"
          style={
            collapsed ? { left: "100%", top: 0 } : { top: "100%", right: 0 }
          }
        >
          <div className={collapsed ? "pl-2" : "pt-2"}>
            <ThemeTriplet />
          </div>
        </div>
      )}
    </div>
  );
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

// Profile chip + upward dropdown, mirroring StaffShell's bottom-of-rail
// profile button. Sign-out flow matches admin-v2/SignOutButton (flip
// engineer/supervisor presence off — no-ops for a reseller — then signOut
// and bounce to /staff).
function ProfileButton({
  email,
  roleLabel,
  collapsed,
}: {
  email: string;
  roleLabel: string;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    const sb = supabaseRef.current;
    try {
      await sb.rpc("engineer_set_online", { _online: false });
    } catch {
      /* best-effort */
    }
    try {
      await sb.rpc("supervisor_set_online", { _online: false });
    } catch {
      /* best-effort */
    }
    try {
      await sb.auth.signOut();
    } finally {
      router.push("/staff");
    }
  };

  const init = initials(email || "??");

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        aria-label="Account menu"
        title={collapsed ? `${email}\n${roleLabel}` : undefined}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          {init}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {email || "—"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roleLabel}
            </div>
          </div>
        )}
        {!collapsed && (
          <ChevronDown
            size={14}
            style={{
              color: "var(--text-muted)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 120ms ease",
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 rounded-md border py-1 shadow-md"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            bottom: "100%",
            left: collapsed ? "100%" : 0,
            right: collapsed ? "auto" : 0,
            marginBottom: collapsed ? 0 : 8,
            marginLeft: collapsed ? 8 : 0,
            minWidth: 200,
          }}
        >
          <div
            className="px-3 py-2"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {email || "—"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roleLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={busy}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.04]"
            style={{ color: "#e05c4b" }}
          >
            <LogOut size={14} />
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
