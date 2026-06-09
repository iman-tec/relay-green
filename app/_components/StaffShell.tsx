"use client";

/*
 * Staff shell — left sidebar layout, collapsible, icon-first.
 *
 * Mirrors the customer-room sidebar pattern (RoomClient) so admin /
 * supervisor / engineer surfaces feel consistent with the customer view.
 *
 * - Sidebar width: 272px open, 60px collapsed. State persists in
 *   localStorage so a reload keeps your preference.
 * - Top: wordmark (full when open, dot-only when collapsed) + toggle.
 * - Middle: nav items, each rendered as icon + label. Labels hide when
 *   collapsed; the icon shows a native tooltip with the label.
 * - Bottom: profile chip with initials avatar + dropdown (email, role,
 *   logout). When collapsed, chip is just the avatar; click expands a
 *   dropdown anchored to the right of the sidebar.
 *
 * Auth-guarded by useStaffGuard. Drives the same notifications + incoming
 * call popup as the legacy EngineerShell.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  LogOut,
  ChevronDown,
  AlertTriangle,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  BarChart3,
  Activity,
  Calendar,
  CalendarClock,
  Eye,
  Users as UsersIcon,
  Wallet as WalletIcon,
  Table as TableIcon,
  Inbox as InboxIcon,
  Settings,
  ShieldCheck,
  FileText,
  Gavel,
  Home,
  PhoneCall,
} from "lucide-react";
import { Wordmark } from "./Wordmark";
import { ThemeTriplet } from "./ThemeTriplet";
import { enterpriseV2Enabled } from "@/lib/flags";
import { EngineerProfilePane } from "./EngineerProfilePane";
import { EngineerPresenceBall } from "./EngineerPresenceBall";
import { LegalPane, type LegalKind } from "./LegalPane";
import { useStaffGuard } from "@/lib/relay/useStaffGuard";
import { registerDeviceAndEnforceLimit } from "@/lib/relay/deviceTracking";
import {
  highestRoleLabel,
  highestRoleSummary,
  formatRole,
} from "@/lib/relay/role-labels";
import { ROLE, type Role } from "@/lib/relay/roles";
// TEMP 2026-05-18: legacy first-come-first-served ring disabled while
// the push-ring path (EngineerIncomingMatch) is validated. Re-enable the
// import + mount below to bring it back.
// import { EngineerIncomingRequest } from "./EngineerIncomingRequest";
import { EngineerIncomingMatch } from "./EngineerIncomingMatch";
import { EngineerAlerts } from "./EngineerAlerts";
import { SupervisorAppointmentToaster } from "./SupervisorAppointmentToaster";
import { useEngineerHeartbeat } from "@/lib/relay/useEngineerHeartbeat";
import { createClient } from "@/lib/supabase/browser";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";
const CRIT_RED = "#8b1a1a";

// 272px: 240 was too tight once the header gained the Home shortcut +
// 3-icon ThemeTriplet + collapse button — the rightmost icon clipped on
// the edge. 272 (= 240 + 32) keeps the visual feel close to the original
// while leaving a comfortable margin for all five header items.
const SIDEBAR_OPEN_W = 272;
const SIDEBAR_CLOSED_W = 60;
const COLLAPSED_KEY = "relay.staff.sidebar.collapsed";

type Nav = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: Role[];
};

// /triage and /settings deliberately omitted from the sidebar.
// /triage was redundant once /dashboard grew Take-next + queue.
// /settings will return when account-settings land.
const NAV: Nav[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: [ROLE.engineer],
  },
  // People + per-customer session history + call log. Engineers see their own
  // sessions; supervisors get an all-platform view of the same surface.
  {
    href: "/inbox",
    label: "Inbox",
    icon: InboxIcon,
    roles: [ROLE.engineer, ROLE.supervisor],
  },
  // Engineer-only. Global quote-request / bid queue across all customers.
  {
    href: "/quotations",
    label: "Quotation",
    icon: FileText,
    roles: [ROLE.engineer],
  },
  // /supervise renders the platform-wide grid for super_admin + supervisor,
  // and the org-scoped grid for enterprise + department admins — see
  // app/(staff)/supervise/page.tsx.
  {
    href: "/supervise",
    label: "Supervise",
    icon: Eye,
    roles: [
      ROLE.supervisor,
      ROLE.department_admin,
      ROLE.enterprise_admin,
      ROLE.super_admin,
    ],
  },
  // super_admin's primary surface — the redesigned 4-tab panel
  // (Enterprise / Reseller / Pods / Internal Users).
  {
    href: "/admin/v2",
    label: "Users",
    icon: UsersIcon,
    roles: [ROLE.super_admin],
  },
  // enterprise_admin's console — the panel's tabs surface directly as
  // sidebar items (the in-page tab strip was removed; ?tab= drives which
  // tab PanelClient renders, so these are plain links). Active-state for
  // these query-carrying hrefs is resolved tab-aware in the nav render.
  {
    href: "/enterprise/v2?tab=overview",
    label: "Overview",
    icon: LayoutDashboard,
    roles: [ROLE.enterprise_admin],
  },
  {
    href: "/enterprise/v2?tab=usage",
    label: "Usage",
    icon: BarChart3,
    roles: [ROLE.enterprise_admin],
  },
  {
    href: "/enterprise/v2?tab=billing",
    label: "Billing",
    icon: WalletIcon,
    roles: [ROLE.enterprise_admin],
  },
  {
    href: "/enterprise/v2?tab=settings",
    label: "Settings",
    icon: Settings,
    roles: [ROLE.enterprise_admin],
  },
  // reseller-owner console — redesigned v2 panel, now under /partner/v2.
  {
    href: "/partner/v2",
    label: "Channel Partner",
    icon: LayoutDashboard,
    roles: [ROLE.reseller],
  },
  // department_admin's console — like the enterprise console above, the
  // panel's tabs surface directly as sidebar ?tab= links; active-state is
  // resolved tab-aware in the nav render.
  {
    href: "/department/v2?tab=overview",
    label: "Overview",
    icon: LayoutDashboard,
    roles: [ROLE.department_admin],
  },
  {
    href: "/department/v2?tab=sessions",
    label: "Sessions",
    icon: Activity,
    roles: [ROLE.department_admin],
  },
  {
    href: "/department/v2?tab=usage",
    label: "Usage",
    icon: BarChart3,
    roles: [ROLE.department_admin],
  },
  {
    href: "/department/v2?tab=settings",
    label: "Settings",
    icon: Settings,
    roles: [ROLE.department_admin],
  },
  // /finance is the org-level money + feedback console — enterprise_admin
  // only. Department admins don't see it; their finance scope is the
  // dept-only view at /department.
  {
    href: "/finance",
    label: "Finance",
    icon: WalletIcon,
    roles: [ROLE.enterprise_admin],
  },
  // /operations is the supervisor's pod roster — engineers under them with
  // current customer + last call.
  {
    href: "/operations",
    label: "Operations",
    icon: TableIcon,
    roles: [ROLE.supervisor],
  },
  // /bids is the pod supervisor's estimation-request / bid queue (the former
  // "Act now" rail beside /supervise, promoted to its own surface).
  {
    href: "/bids",
    label: "Bids",
    icon: Gavel,
    roles: [ROLE.supervisor],
  },
  // Supervisor-only. Upcoming appointments customers booked off a bid
  // (Contract management → "Ask for appointment"). Backed by
  // supervisor_bookings; see app/(staff)/schedule.
  {
    href: "/schedule",
    label: "Schedule",
    icon: CalendarClock,
    roles: [ROLE.supervisor],
  },
  // Weekly/monthly availability calendar — engineers AND supervisors. Same
  // editor (CalendarTab); each user manages their own windows. Placed last so
  // it sits under Supervise/Operations on the supervisor sidebar and after
  // Dashboard/Inbox on the engineer sidebar.
  {
    href: "/calendar",
    label: "Calendar",
    icon: Calendar,
    roles: [ROLE.engineer, ROLE.supervisor],
  },
];

// /calendar and /inbox are intentionally NOT here — both are shared with
// supervisors (calendar: each manages their own availability; inbox: engineers
// see their own sessions, supervisors get an all-platform view), so
// non-engineers must not be bounced off them.
const ENGINEER_ONLY_PATHS = ["/dashboard", "/quotations", "/staff/session"];

function isEngineer(roles: readonly Role[]): boolean {
  return roles.includes(ROLE.engineer);
}

// Allow-list for the supervisor toasters (escalations, reassign, appointments).
// ONLY actual ops roles — supervisor + super_admin (who gets toasts on /admin/v2
// per the comment at the mount sites). Enterprise/department admins and resellers
// are NOT ops and must never receive escalation/appointment alerts — this is the
// gate that closes the cross-role leak (a deny-list of `!isEngineer` let them in).
function isSupervisorRole(roles: readonly Role[]): boolean {
  return roles.includes(ROLE.supervisor) || roles.includes(ROLE.super_admin);
}

// Map an ?tab= value (incl. legacy aliases like ?tab=wallet) onto the
// enterprise panel's four sidebar entries. Mirrors resolveInitial in
// app/(staff)/enterprise/v2/PanelClient.tsx — keep the two in sync.
function enterpriseTabOf(param: string | null): string {
  switch (param) {
    case "usage":
      return "usage";
    case "wallet":
    case "billing":
      return "billing";
    case "settings":
      return "settings";
    default:
      return "overview"; // dashboard / departments / members / null
  }
}

// Same idea for the department console's sidebar entries. Mirrors
// resolveInitial in app/(staff)/department/v2/PanelClient.tsx.
function departmentTabOf(param: string | null): string {
  switch (param) {
    case "sessions":
      return "sessions";
    case "usage":
      return "usage";
    case "settings":
      return "settings";
    default:
      return "overview"; // dashboard / members / null
  }
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Query string is part of nav identity for the enterprise console items
  // (/enterprise/v2?tab=…). Safe without a Suspense boundary here: every
  // (staff) route is dynamically rendered (the group layout reads auth
  // cookies), so there's no static prerender to bail out of.
  const searchParams = useSearchParams();
  const router = useRouter();
  const guard = useStaffGuard();
  const roles = guard.kind === "staff" ? guard.roles : [];
  const engineer = isEngineer(roles);
  const supervisorAlerts = isSupervisorRole(roles);
  const isEnterpriseAdmin =
    roles.includes(ROLE.enterprise_admin) && !roles.includes(ROLE.super_admin);
  const homeHref = isEnterpriseAdmin
    ? "/enterprise/v2"
    : engineer
      ? "/dashboard"
      : "/supervise";

  const [collapsed, setCollapsed] = useState(false);

  // Drag-to-resize the expanded sidebar. Clamped + persisted to
  // localStorage so the user's chosen width survives refresh. Collapsed
  // state still snaps to SIDEBAR_CLOSED_W (60px) for the icon rail.
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 480;
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_OPEN_W);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("relay:staff-sidebar-width");
      const parsed = raw ? Number(raw) : NaN;
      if (
        Number.isFinite(parsed) &&
        parsed >= SIDEBAR_MIN &&
        parsed <= SIDEBAR_MAX
      ) {
        setSidebarWidth(parsed);
      }
    } catch {
      /* fall through to default */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "relay:staff-sidebar-width",
        String(sidebarWidth)
      );
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const startSidebarDrag = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();
      setSidebarDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (mv: PointerEvent) => {
        const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, mv.clientX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        setSidebarDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [collapsed]
  );

  // Presence heartbeat — engineers only. The RPC self-gates with NOT_AN_ENGINEER
  // so non-engineer staff who incidentally render this shell are no-ops.
  useEngineerHeartbeat(engineer);

  // In-pane overlays — Profile & settings (engineer-only) and the Privacy/
  // Terms viewer. When open, the corresponding pane renders IN PLACE OF
  // the route's <main> children so the customer's mental model of "pane
  // takes over the centre, sidebar stays put" carries over to staff.
  const [profilePaneOpen, setProfilePaneOpen] = useState(false);
  const [legalKind, setLegalKind] = useState<LegalKind | null>(null);
  const closeAllPanes = useCallback(() => {
    setProfilePaneOpen(false);
    setLegalKind(null);
  }, []);

  // Auth row pulled once at the shell level so both the user-menu trigger
  // and the EngineerProfilePane can share it without duplicate getUser()
  // round-trips. Empty string until the first fetch settles.
  const [meEmail, setMeEmail] = useState<string>("");
  useEffect(() => {
    if (guard.kind !== "staff") return;
    if (meEmail) return;
    let cancelled = false;
    void (async () => {
      const sb = (await import("@/lib/supabase/browser")).createClient();
      const { data } = await sb.auth.getUser();
      if (!cancelled && data.user?.email) setMeEmail(data.user.email);
    })();
    return () => {
      cancelled = true;
    };
  }, [guard.kind, meEmail]);

  // On mount: phones always start collapsed (the expanded nav doesn't fit),
  // regardless of any saved desktop preference. On wider screens, restore the
  // saved preference.
  useEffect(() => {
    try {
      const mobile =
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 767px)").matches;
      if (mobile) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
        return;
      }
      const v = localStorage.getItem(COLLAPSED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "1") setCollapsed(true);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  // Redirect engineer-only pages if a non-engineer somehow lands there
  // (e.g. an admin clicks a stale link). Mirrors the legacy guard.
  const inEngineerOnlyArea = ENGINEER_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  useEffect(() => {
    if (guard.kind === "staff" && !engineer && inEngineerOnlyArea) {
      router.replace("/supervise");
    }
  }, [guard.kind, engineer, inEngineerOnlyArea, router]);

  // Auto-open the Profile pane when the user lands on /settings (preserves
  // deep-link entry into Profile & settings). Must sit ABOVE the early
  // returns so the hook count is stable across loading/anonymous/staff
  // renders — React enforces same-order hooks every render.
  useEffect(() => {
    if (pathname === "/settings" && engineer && !profilePaneOpen) {
      setProfilePaneOpen(true);
    }
  }, [pathname, engineer, profilePaneOpen]);

  // Close the Profile pane when the user navigates somewhere else. The pane
  // renders INSIDE <main> in place of the page content, so without this a
  // sidebar nav click changes the route but the pane stays mounted and the
  // destination never appears ("clicking Dashboard/Inbox/Calendar does
  // nothing"). We only act on a real pathname change (tracked via ref) so
  // opening the pane from the user menu on the current page doesn't instantly
  // close it; navigating to /settings keeps it open (the effect above).
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    if (pathname !== "/settings" && profilePaneOpen) {
      setProfilePaneOpen(false);
    }
  }, [pathname, profilePaneOpen]);

  // Device tracking — registers this browser as a device and auto-revokes
  // the oldest device when the user is over the 3-device cap. Best-effort:
  // failures are logged but never block the user. Runs once per shell
  // mount after auth resolves.
  useEffect(() => {
    if (guard.kind !== "staff") return;
    void registerDeviceAndEnforceLimit();
  }, [guard.kind]);

  if (guard.kind === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--background)" }}
      >
        <Loader2
          size={20}
          className="animate-spin"
          style={{ color: BRAND_GREEN }}
        />
      </div>
    );
  }
  if (guard.kind === "anonymous") return null;
  if (guard.kind === "not-staff") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="max-w-sm text-center">
          <h2
            className="mb-2 text-lg font-semibold"
            style={{ color: "var(--text)" }}
          >
            Staff access required
          </h2>
          <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Your account doesn&apos;t have an engineer / supervisor / admin role
            yet. Contact your admin or sign in with a staff account.
          </p>
          <div className="flex justify-center gap-2">
            <Link
              href="/staff"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              Staff sign in
            </Link>
            <Link
              href="/room"
              className="rounded-md border px-4 py-2 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Customer view
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Bare mode — render children full-viewport with no shell chrome.
  // Used by the v2 panels where each panel owns its own navigation
  // (tab header). The guard still runs above, so auth + role
  // enforcement stays intact.
  // NOTE: /enterprise/v2 and /department/v2 are embedded (NOT bare) by default
  // — they share this sidebar chrome. The reimagined command centers flip them
  // to bare-mode ONLY when NEXT_PUBLIC_ENTERPRISE_V2 is on (each panel then owns
  // its own rail). Flag off → unchanged embedded tabs.
  const orgV2 = enterpriseV2Enabled();
  const isBare =
    pathname === "/admin/v2" ||
    pathname.startsWith("/admin/v2/") ||
    pathname === "/partner/v2" ||
    pathname.startsWith("/partner/v2/") ||
    (orgV2 &&
      (pathname === "/enterprise/v2" ||
        pathname.startsWith("/enterprise/v2/") ||
        pathname === "/department/v2" ||
        pathname.startsWith("/department/v2/")));
  if (isBare) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
      >
        {children}
        {/* The v2 panels strip the shell chrome but must still surface the
            incoming-call ring (engineers) and supervisor alerts — including the
            "assignment declined, reassign" toast — so a super_admin sitting on
            /admin/v2 is notified just like on /supervise. */}
        {isEngineer(roles) && <EngineerIncomingMatch />}
        {supervisorAlerts && <SupervisorAlerts roles={roles} />}
        {supervisorAlerts && <SupervisorAppointmentToaster />}
      </div>
    );
  }

  // Enterprise admins should only see their two-tab console:
  //   /enterprise  (dashboard)
  //   /supervise   (org-scoped view, branches server-side on role)
  // Without this filter, an enterprise_admin who also happens to hold
  // platform-side roles for testing would see /admin/users in the sidebar.
  const ENT_ADMIN_ALLOW = new Set([
    "/enterprise/v2",
    "/enterprise",
    "/enterprise/departments",
  ]);
  // Routes that super_admin should never see even when they hold the
  // underlying role for testing (e.g. dev.soni also has supervisor so she
  // can join real sessions, but /operations is a supervisor surface).
  const SUPER_ADMIN_HIDDEN = new Set(["/operations", "/bids"]);
  const isSuperAdmin = roles.includes(ROLE.super_admin);
  const navItems = NAV.filter((n) => n.roles.some((r) => roles.includes(r)))
    // Strip the ?tab=… query before matching — the enterprise console
    // items all live under the allowed /enterprise/v2 path.
    .filter(
      (n) => !isEnterpriseAdmin || ENT_ADMIN_ALLOW.has(n.href.split("?")[0])
    )
    .filter((n) => !isSuperAdmin || !SUPER_ADMIN_HIDDEN.has(n.href));

  return (
    // App-shell layout: lock the document viewport with h-screen +
    // overflow-hidden so the sidebar (a flex-row sibling at fixed width)
    // never scrolls, and let <main> below own the only scrollable region.
    // Pages with long content (calendar, settings, admin tables) scroll
    // *inside* <main>; pages with their own h-screen flex layouts
    // (dashboard, inbox, supervise) fit perfectly because <main>'s height
    // equals the viewport.
    <div
      className="relative flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--background)" }}
    >
      <aside
        // On phones the aside is pulled OUT of flow (`absolute`) so expanding
        // it overlays the page instead of pushing <main> rightwards — a
        // standard mobile drawer. <main> reserves the collapsed-rail width
        // (pl) so the always-visible icon rail never sits on top of content.
        // From `lg` up it returns to an in-flow flex sibling (`lg:relative`)
        // and the push-to-resize behaviour is unchanged.
        className={`absolute inset-y-0 left-0 z-40 flex h-full shrink-0 flex-col border-r lg:relative lg:inset-auto lg:z-auto ${sidebarDragging ? "" : "transition-[width] duration-200 ease-out"}`}
        style={{
          width: collapsed ? SIDEBAR_CLOSED_W : sidebarWidth,
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          // Both `absolute` (mobile) and `lg:relative` (desktop) make this a
          // positioned ancestor, so the drag-resize handle below anchors here
          // in either mode.
        }}
      >
        {/* Drag-to-resize handle on the right edge. Hidden when the
            sidebar is collapsed (the user toggles back via the icon).
            6px wide invisible hit zone; subtle accent on hover so the
            affordance is discoverable. Cursor flips to col-resize. */}
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={startSidebarDrag}
            className={`group absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[var(--primary-soft)] ${sidebarDragging ? "bg-[var(--primary)]" : ""}`}
            style={{ transform: "translateX(50%)" }}
          />
        )}
        {/* Top: wordmark + theme triplet + home + collapse toggle.
            Wordmark already links home, but engineers asked for an explicit
            Home icon back — the wordmark is visually busy with the presence
            dot and easy to read as a label rather than a button. */}
        <div
          className="flex items-center gap-2 border-b px-3 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <Link
            href={homeHref}
            className="flex items-center no-underline"
            aria-label="Home"
            title="Home"
          >
            {collapsed ? <DotOnly /> : <Wordmark size="md" />}
          </Link>
          {!collapsed && (
            <>
              <Link
                href={homeHref}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                style={{
                  color: BRAND_GREEN,
                  backgroundColor: BRAND_GREEN_SOFT,
                }}
                aria-label="Go to dashboard"
                title="Dashboard"
              >
                <Home size={15} />
              </Link>
              <span className="flex-1" />
              <ThemeTriplet />
              <button
                type="button"
                onClick={toggle}
                className="rounded-md p-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                aria-label="Collapse sidebar"
                style={{ color: "var(--text-muted)" }}
              >
                <PanelLeftClose size={16} />
              </button>
            </>
          )}
        </div>

        {/* Collapsed-mode toggle (separate row so it's reachable). Mirrors the
            nav-item box (px-2 container + full-width, centered icon, py-2) so
            its icon lines up vertically with the nav icons below it. */}
        {collapsed && (
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center justify-center rounded-md py-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              aria-label="Expand sidebar"
              style={{ color: "var(--text-muted)" }}
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Path match first; for query-carrying hrefs (the enterprise /
            // department console tabs) the ?tab= must match too, or all
            // sibling items would light up together on the shared path.
            const [itemPath, itemQuery] = item.href.split("?");
            let active =
              pathname === itemPath || pathname.startsWith(itemPath + "/");
            if (active && itemQuery) {
              const want = new URLSearchParams(itemQuery).get("tab");
              const tabOf = itemPath.startsWith("/department/v2")
                ? departmentTabOf
                : enterpriseTabOf;
              active = tabOf(searchParams?.get("tab") ?? null) === want;
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  // On mobile, collapse the nav after picking a destination so
                  // the page content takes over (matches the inbox People rail).
                  if (
                    typeof window !== "undefined" &&
                    window.matchMedia("(max-width: 767px)").matches
                  ) {
                    setCollapsed(true);
                  }
                }}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors"
                style={{
                  fontWeight: active ? 600 : 500,
                  color: active ? BRAND_GREEN : "var(--text)",
                  backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <Icon size={16} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}

          {/* Engineer presence ball — sits directly under the Calendar
              nav item, sandwiched between hairline separators so it
              reads as its own zone. Ring + audio fire here when a match
              offer lands via realtime. */}
          {engineer && guard.kind === "staff" && (
            <>
              <div
                className="mx-1 my-2 h-px"
                style={{ backgroundColor: "var(--border)" }}
                aria-hidden
              />
              <EngineerPresenceBall
                userId={guard.userId}
                collapsed={collapsed}
              />
              <div
                className="mx-1 my-2 h-px"
                style={{ backgroundColor: "var(--border)" }}
                aria-hidden
              />
            </>
          )}

          {/* Spacer pushes alerts + profile to bottom */}
          <div className="flex-1" />
        </nav>

        {/* FIFO auto-ring — 30s after the engineer's session ends, if
            there's still a queue and they're online, claim the next
            customer. Empty render — pure side-effect. */}
        {engineer && guard.kind === "staff" && <FifoAutoRing />}

        {/* Rejoin-call CTA — visible only while the engineer has an active
            session (e.g. they pressed Back during a live call). Sits just above
            the profile chip; the component renders nothing when off a call. */}
        {engineer && guard.kind === "staff" && (
          <RejoinCallButton collapsed={collapsed} />
        )}

        {/* Bottom: profile. The theme triplet lives only in the top header
            (next to wordmark + home), which is shown when the sidebar is open —
            so when collapsed there's no theme control here (it looked cramped
            crammed into the icon rail).
            mb-4 lifts the chip clear of the bottom edge so it doesn't
            kiss the viewport on short screens. */}
        <div
          className="mb-4 border-t px-2 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <ProfileButton
            email={meEmail}
            onEmailResolved={setMeEmail}
            roles={roles}
            collapsed={collapsed}
            engineer={engineer}
            onOpenProfile={() => {
              closeAllPanes();
              setProfilePaneOpen(true);
            }}
            onOpenLegal={(kind) => {
              closeAllPanes();
              setLegalKind(kind);
            }}
          />
        </div>
      </aside>

      {/* Mobile-only scrim: when the drawer is expanded on a phone it sits at
          z-40 over the page; this dims the rest and taps-to-close. Hidden from
          `lg` up where the sidebar is in-flow and pushes instead of overlays. */}
      {!collapsed && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setCollapsed(true)}
          className="absolute inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      {/* Sole scroll region. flex-1 + min-w-0 + h-full + overflow-y-auto
          is the canonical "fills remaining row width, full row height,
          scrolls own content" pattern. Routes with internal h-screen flex
          layouts (dashboard, inbox, supervise) naturally fit because
          <main> equals the viewport height; routes with naturally tall
          DOM (calendar, settings, admin tables) scroll here instead of
          taking the document with them — which is exactly what kept the
          sidebar moving in the original bug. */}
      <main className="h-full min-w-0 flex-1 overflow-y-auto pl-[60px] lg:pl-0">
        {profilePaneOpen && engineer && guard.kind === "staff" ? (
          <EngineerProfilePane
            userId={guard.userId}
            email={meEmail}
            onClose={() => {
              setProfilePaneOpen(false);
              // If we landed via /settings, send the user home so the URL
              // and the pane state stop disagreeing.
              if (pathname === "/settings") router.push("/dashboard");
            }}
          />
        ) : legalKind ? (
          <LegalPane kind={legalKind} onClose={() => setLegalKind(null)} />
        ) : (
          children
        )}
      </main>

      {/* Full-screen incoming-call popup for anyone who can take calls
       *  (engineer role). The modal self-gates: it only renders when
       *  match_engineer has created a PENDING offer for this exact user, and
       *  the matcher only offers to engineers whose availability toggle is on
       *  (engineer_profiles.is_available). So a supervisor/admin who also
       *  holds engineer is only paged if they've gone "Online" as an engineer
       *  — availability is the control, not role composition. (Previously
       *  gated to engineer-ONLY accounts, which silently suppressed rings for
       *  multi-role engineers.)
       *
       *  TEMP 2026-05-18: legacy EngineerIncomingRequest mount disabled while
       *  the push-ring (EngineerIncomingMatch) path is validated. */}
      {/* {isEngineer(roles) && <EngineerIncomingRequest />} */}
      {isEngineer(roles) && <EngineerIncomingMatch />}

      {/* Engineer-only: pop-up toasts for new scheduled calls (transient) +
          new bid requests (sticky until dismissed). Shown on every staff page
          via this shared shell, but not inside a live call (the session route
          is outside the (staff) layout). */}
      {engineer && <EngineerAlerts />}

      {/* Supervisor-only: non-blocking urgent session alerts */}
      {supervisorAlerts && <SupervisorAlerts roles={roles} />}

      {/* Supervisor-only: appointment-booked pop-up on every staff screen
          (auto-dismiss 5s). The notification bell keeps the full history. */}
      {supervisorAlerts && <SupervisorAppointmentToaster />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function DotOnly() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        backgroundColor: BRAND_GREEN,
      }}
    />
  );
}

function ProfileButton({
  email,
  onEmailResolved,
  roles,
  collapsed,
  engineer,
  onOpenProfile,
  onOpenLegal,
}: {
  email: string;
  onEmailResolved: (email: string) => void;
  roles: string[];
  collapsed: boolean;
  engineer: boolean;
  onOpenProfile: () => void;
  onOpenLegal: (kind: LegalKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (email) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabaseRef.current.auth.getUser();
      if (!cancelled && data.user?.email) {
        onEmailResolved(data.user.email);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, onEmailResolved]);

  // Engineer ALIAS — the customer-facing pseudonym (e.g. "Sky") from
  // engineer_profiles.display_alias. Shown as the chip's primary name;
  // the raw email stays in the dropdown header + hover tooltip.
  const [alias, setAlias] = useState<string | null>(null);
  useEffect(() => {
    if (!engineer) return;
    let cancelled = false;
    (async () => {
      const sb = supabaseRef.current;
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) return;
      const { data } = await sb
        .from("engineer_profiles")
        .select("display_alias")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (!cancelled && data?.display_alias)
        setAlias(data.display_alias as string);
    })();
    return () => {
      cancelled = true;
    };
  }, [engineer]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleSignOut = async () => {
    // Flip the engineer to Offline BEFORE the session dies, so the matcher
    // and supervisor/admin assign list stop showing them as available.
    //
    // Using set_engineer_presence('offline') (not the legacy
    // engineer_set_online(false)) because it ALSO writes presence_state =
    // 'offline'. That's the source of truth the dashboard ball reads on
    // next login — without it, an engineer who logged out while Online
    // would re-appear as Online on next login (presence_state stuck at
    // 'online' even though is_available was flipped to false). The new
    // login default is "Offline; engineer manually goes Online when
    // ready", and this is the half of the change that the DB needs.
    //
    // Non-engineer roles get NOT_AN_ENGINEER, which we ignore (this is a
    // best-effort cleanup; the auth.signOut below is the real gate).
    try {
      await supabaseRef.current.rpc("set_engineer_presence", {
        _state: "offline",
      });
    } catch {
      /* best-effort cleanup */
    }
    // Supervisors go off duty on logout too, so coverage re-routes to whoever
    // is still on duty (non-supervisors get NOT_A_SUPERVISOR, which we ignore).
    try {
      await supabaseRef.current.rpc("supervisor_set_online", {
        _online: false,
      });
    } catch {
      /* best-effort cleanup */
    }
    await supabaseRef.current.auth.signOut();
    router.push("/staff");
  };

  const userEmail = email;
  const displayName = alias || userEmail || "—";
  const userInitials = alias
    ? alias
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : initials(userEmail || "??");
  // Chip shows the *top* role per the hierarchy with a "+N" hint when the
  // user holds more than one. The full list lives on the hover tooltip
  // (and inside the dropdown) so the chip stays compact.
  const roleText = highestRoleSummary(roles);
  const allRolesLabel =
    roles.length > 0
      ? roles.map((r) => formatRole(r)).join(" · ")
      : highestRoleLabel(roles);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        aria-label="Account menu"
        title={
          collapsed
            ? `${userEmail}\n${allRolesLabel}`
            : roles.length > 1
              ? allRolesLabel
              : undefined
        }
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          {userInitials}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1" title={userEmail || undefined}>
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {displayName}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roleText}
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
            // Anchor: in collapsed mode → expand to the right; otherwise → up
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
              {userEmail || "—"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roles.length > 1 ? allRolesLabel : roleText}
            </div>
          </div>
          {engineer && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ color: "var(--text)" }}
            >
              <Settings size={14} />
              Profile &amp; settings
            </button>
          )}
          {roles.includes("enterprise_admin") && (
            <Link
              href="/enterprise/v2?tab=billing"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm no-underline transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ color: "var(--text)" }}
            >
              <WalletIcon size={14} />
              Wallet
            </Link>
          )}
          {/* Learn more section — Privacy + Terms open in-pane (no new tab),
             same pattern the customer side uses to keep legal docs scrollable
             alongside the shell. */}
          <div
            className="border-t px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase"
            style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
          >
            Learn more
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenLegal("privacy");
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)" }}
          >
            <ShieldCheck size={14} />
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenLegal("terms");
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)" }}
          >
            <FileText size={14} />
            Terms of Use
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)", borderColor: "var(--border)" }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Rejoin-call button ──────────────────────────────────────────────────
// A shortcut back into the engineer's live session. If they press Back while
// connected to a customer, the session stays live (claimed_by them); this
// button — pinned just above the profile chip — drops them straight back in.
// Hidden whenever they have no active session, so it never shows off a call.
function RejoinCallButton({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const { myActive } = useEngineerWorkspace();
  // The session they're actively in (claimed + non-terminal). Prefer a live
  // call, then grace / joining / assigned. None → render nothing.
  const active =
    myActive.find((s) => s.status === "live") ??
    myActive.find((s) => s.status === "grace") ??
    myActive.find((s) => s.status === "joining") ??
    myActive.find((s) => s.status === "assigned") ??
    null;
  if (!active) return null;
  return (
    <div className="px-2 pb-1">
      <button
        type="button"
        onClick={() => router.push(`/staff/session/${active.id}`)}
        title="Rejoin your active call"
        aria-label="Rejoin your active call"
        className={`flex w-full items-center rounded-lg px-2 py-2 text-[13px] font-semibold text-white shadow-sm transition-[filter] hover:brightness-110 ${
          collapsed ? "justify-center" : "justify-center gap-2"
        }`}
        style={{ backgroundColor: "var(--primary)" }}
      >
        <PhoneCall size={collapsed ? 16 : 14} className="shrink-0" />
        {!collapsed && <span>Rejoin call</span>}
      </button>
    </div>
  );
}

// ── FIFO auto-ring ──────────────────────────────────────────────────────
// 30 seconds after the engineer's active session transitions to "ended",
// check the queue; if there's a waiting customer AND the engineer is
// still online (presence_state='online'), claim the next one.
//
// Watches `myActive` from useEngineerWorkspace for the ended transition
// (vs. tailing guest_calls directly) because that hook already does the
// realtime subscription and dedupes. Auto-ring fires once per ended
// session — a ref tracks which session ids we've already armed for.
//
// Render-side this component is invisible; it just owns the effect.
function FifoAutoRing() {
  const sbRef = useRef(createClient());
  const router = useRouter();
  const { myActive, queue, takeNext, userId } = useEngineerWorkspace();
  const armedRef = useRef<Set<string>>(new Set());
  const lastActiveRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // Build a map of session_id → status for the current active set.
    const currentMap = new Map<string, string>();
    for (const s of myActive) currentMap.set(s.id, s.status);

    // Detect sessions that transitioned to "ended" since the last render.
    for (const [id, prevStatus] of lastActiveRef.current.entries()) {
      const nowStatus = currentMap.get(id);
      const wasLive = [
        "assigned",
        "joining",
        "live",
        "grace",
        "expired_free",
      ].includes(prevStatus);
      const nowEnded = nowStatus === "ended" || !currentMap.has(id);
      if (wasLive && nowEnded && !armedRef.current.has(id)) {
        armedRef.current.add(id);
        // 30s grace, then re-check the queue + presence and claim.
        setTimeout(async () => {
          try {
            const sb = sbRef.current;
            if (!userId) return;
            // Check presence — only auto-claim when the engineer is
            // explicitly online (busy / offline / unset = skip).
            const { data: prof } = await sb
              .from("engineer_profiles")
              .select("presence_state, is_available")
              .eq("user_id", userId)
              .maybeSingle();
            const presenceRow = (prof ?? null) as {
              presence_state: string | null;
              is_available: boolean | null;
            } | null;
            const isOnline = presenceRow
              ? presenceRow.presence_state === "online" ||
                (presenceRow.presence_state == null &&
                  presenceRow.is_available === true)
              : false;
            if (!isOnline) return;

            // Check queue afresh — it may have drained while we waited.
            const { data: liveQueue } = await sb
              .from("guest_calls")
              .select("id")
              .eq("status", "queued")
              .order("created_at", { ascending: true })
              .limit(1);
            if (!liveQueue || liveQueue.length === 0) return;

            const claimed = await takeNext();
            if (claimed) {
              // Land the engineer in the session room for the auto-claimed
              // call. Same destination as the manual "Take next call".
              router.push(`/staff/session/${claimed.id}`);
            }
          } catch (err) {
            console.warn("[fifo-auto-ring] failed:", err);
          }
        }, 30_000);
      }
    }

    // Snapshot current status for the next render comparison.
    lastActiveRef.current = currentMap;
  }, [myActive, queue.length, userId, takeNext, router]);

  return null;
}

/* ──────── Supervisor toast alerts (same logic as legacy shell) ──────── */

// AlertToast urgency union now includes "escalation" — engineer-initiated
// supervisor pull-in from a live session_escalations row.
type AlertToast = {
  id: string;
  sessionId: string;
  name: string;
  urgency: string;
  /** Only set for escalation toasts — used to acknowledge_escalation
   *  + navigate when the supervisor clicks Acknowledge & join. */
  escalationId?: string;
  reason?: string;
};

// Same key the EngineerPresenceBall uses, so muting the engineer ring
// also mutes the supervisor escalation ring on the same device. One
// switch, two consumers — keeps the affordance discoverable.
const SUPERVISOR_MUTE_KEY = "relay.engineer.ring.muted.v1";

function SupervisorAlerts({ roles }: { roles: readonly Role[] }) {
  const isSupervisor = isSupervisorRole(roles);
  const pathname = usePathname();
  const onSupervise =
    !!pathname &&
    (pathname === "/supervise" || pathname.startsWith("/supervise/"));
  const [alerts, setAlerts] = useState<AlertToast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // Separate dedupe set for "reassignment needed" toasts so a session can be
  // re-flagged after it's reassigned (cleared when reassign_needed goes false).
  const seenReassignRef = useRef<Set<string>>(new Set());
  // Dedupe for escalation toasts — keyed by escalation row id so the
  // same row can't toast twice.
  const seenEscalationRef = useRef<Set<string>>(new Set());
  const supabaseRef = useRef(createClient());
  const router = useRouter();

  const dismiss = (id: string) =>
    setAlerts((prev) => prev.filter((a) => a.id !== id));

  // Auto-dismiss toasts so they don't linger on the supervisor's screen.
  //  • Escalation toasts PERSIST while the supervisor is off the Supervise
  //    screen (so they can't miss a raised hand), then clear 5s after they
  //    land on /supervise (or 5s from appearing if already there).
  //  • Other toasts (reassign / urgent-session) clear after 10s regardless.
  // Each toast is scheduled exactly once (tracked in a ref) — re-running on
  // pathname change is what arms the escalation timer once they reach Supervise.
  const autoExpiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of alerts) {
      if (autoExpiredRef.current.has(a.id)) continue;
      if (a.urgency === "escalation" && !onSupervise) continue; // keep persistent
      autoExpiredRef.current.add(a.id);
      setTimeout(
        () => setAlerts((prev) => prev.filter((x) => x.id !== a.id)),
        a.urgency === "escalation" ? 5_000 : 10_000
      );
    }
  }, [alerts, onSupervise]);

  useEffect(() => {
    if (!isSupervisor) return;
    const sb = supabaseRef.current;
    // Per-mount UUID suffix on the channel name. The previous fixed name
    // ("supervisor-alerts-shell") was the worst case for Supabase's
    // name-based dedupe — every supervisor load reused it, so a stale
    // subscription from a previous render would refuse the new .on()
    // with "cannot add postgres_changes after subscribe()".
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`supervisor-alerts-shell-${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        (payload) => {
          const row = (payload.new ?? payload.old) as GuestCall | null;
          if (!row || !row.id) return;

          // A directed (manual) assignment was declined → the supervisor needs
          // to reassign. Toast once per reassignment episode; clear the dedupe
          // marker when the flag goes false so a later decline re-notifies.
          if (row.reassign_needed) {
            if (!seenReassignRef.current.has(row.id)) {
              seenReassignRef.current.add(row.id);
              setAlerts((prev) => [
                ...prev,
                {
                  id: `${row.id}-reassign-${Date.now()}`,
                  sessionId: row.id,
                  name: row.guest_name ?? "A customer",
                  urgency: "reassign",
                },
              ]);
            }
          } else {
            seenReassignRef.current.delete(row.id);
          }

          const urgent = row.urgency === "urgent" || row.urgency === "critical";
          const liveish = [
            "queued",
            "assigned",
            "joining",
            "live",
            "grace",
          ].includes(row.status as string);
          if (!urgent || !liveish) return;
          if (seenRef.current.has(row.id)) return;
          seenRef.current.add(row.id);
          setAlerts((prev) => [
            ...prev,
            {
              id: `${row.id}-${Date.now()}`,
              sessionId: row.id,
              name: (row as { full_name?: string }).full_name ?? "Guest",
              urgency: row.urgency as string,
            },
          ]);
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [isSupervisor]);

  // Separate channel for engineer-initiated escalations. Toasts are
  // visually + audibly louder than the urgent-session toast above so
  // supervisors learn the difference by ear. Subscribes to INSERT only
  // (acked/joined/resolved updates don't toast — those are the
  // supervisor's own actions or the engineer closing the loop).
  useEffect(() => {
    if (!isSupervisor) return;
    const sb = supabaseRef.current;
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`supervisor-escalations-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_escalations",
        },
        (payload) => {
          const row = payload.new as {
            id?: string;
            session_id?: string;
            engineer_user_id?: string;
            reason?: string | null;
            status?: string;
          } | null;
          if (!row?.id || !row.session_id) return;
          // session_escalations rows are 'open' when raised (not 'pending') —
          // the old check silently dropped every escalation toast.
          if (row.status && row.status !== "open") return;
          if (seenEscalationRef.current.has(row.id)) return;
          seenEscalationRef.current.add(row.id);

          // Lookup the customer name for the toast headline. Cheap one-off.
          void (async () => {
            const { data } = await sb
              .from("guest_calls")
              .select("guest_name")
              .eq("id", row.session_id)
              .maybeSingle();
            const name =
              (data as { guest_name?: string | null } | null)?.guest_name ??
              "A live session";
            setAlerts((prev) => [
              ...prev,
              {
                id: `escalation-${row.id}`,
                sessionId: row.session_id!,
                name,
                urgency: "escalation",
                escalationId: row.id,
                reason: row.reason ?? undefined,
              },
            ]);
            playEscalationRingtone();
          })();
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [isSupervisor]);

  // Acknowledge + navigate. Used by the toast's primary CTA. First
  // supervisor wins via the RPC's UPDATE-with-where-status='pending'.
  const acknowledgeAndJoin = useCallback(
    async (toast: AlertToast) => {
      if (!toast.escalationId) return;
      const sb = supabaseRef.current;
      const { error: e } = await sb.rpc("acknowledge_escalation", {
        _id: toast.escalationId,
      });
      if (e) {
        // ALREADY_TAKEN: surface lightly + drop the toast. Another
        // supervisor beat us to it.
        console.warn("[supervisor-alerts] escalation ack failed:", e.message);
        setAlerts((prev) => prev.filter((a) => a.id !== toast.id));
        return;
      }
      setAlerts((prev) => prev.filter((a) => a.id !== toast.id));
      // ?join=1 unlocks the chat composer for the supervisor (and stamps the
      // escalation joined) — same as the /supervise "Join call" button.
      router.push(`/staff/session/${toast.sessionId}?join=1`);
    },
    [router]
  );

  if (!isSupervisor || !alerts.length) return null;

  return (
    <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {alerts.map((a) => {
        const isEscalation = a.urgency === "escalation";
        const tintFg =
          a.urgency === "critical" || isEscalation ? CRIT_RED : URGENT_AMBER;
        // OPAQUE tinted surface (mixed over --surface, not the translucent
        // *_SOFT rgba) so the page text behind the toast doesn't bleed through.
        const tintBg = `color-mix(in srgb, ${tintFg} 16%, var(--surface))`;
        return (
          <div
            key={a.id}
            className="flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg"
            style={{
              backgroundColor: tintBg,
              borderColor: tintFg,
              color: "var(--text)",
              maxWidth: 380,
              animation: isEscalation
                ? "relay-toast-in 200ms ease-out"
                : undefined,
              boxShadow: isEscalation ? `0 10px 28px ${tintFg}55` : undefined,
            }}
          >
            <AlertTriangle size={16} style={{ color: tintFg, marginTop: 2 }} />
            <div className="flex-1">
              <div className="text-sm font-medium">
                {isEscalation
                  ? `Engineer needs help — ${a.name}`
                  : a.urgency === "reassign"
                    ? "Assignment declined"
                    : a.name}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {isEscalation
                  ? a.reason
                    ? `"${a.reason}"`
                    : "Live escalation — supervisor needed"
                  : a.urgency === "reassign"
                    ? `${a.name} needs a new engineer — reassign in Supervise`
                    : `${a.urgency} session`}
              </div>
              {isEscalation && (
                <div className="mt-2 flex justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void acknowledgeAndJoin(a)}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: tintFg }}
                  >
                    Acknowledge &amp; join
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="rounded-md p-1"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Escalation ringtone — three-beat urgent pattern. Louder and longer
// than the EngineerPresenceBall match-offer ringtone (which is 880-660-880
// over ~0.85s) so supervisors learn the cadence: this one is an
// engineer-initiated escalation, not a routine match. Respects the
// shared MUTE key so muting the engineer ring also silences this.
function playEscalationRingtone() {
  try {
    if (typeof window === "undefined") return;
    const muted = window.localStorage.getItem(SUPERVISOR_MUTE_KEY) === "1";
    if (muted) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx: AudioContext = new Ctor();
    const now = ctx.currentTime;
    const beep = (start: number, hz: number, dur: number, vol: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
      gain.gain.setValueAtTime(vol, now + start + dur - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };
    // Urgent cadence: low-high-low-high two-pair pattern at higher
    // amplitude than the match-offer ringtone. Total ~1.4s.
    beep(0.0, 520, 0.3, 0.14);
    beep(0.32, 880, 0.3, 0.14);
    beep(0.72, 520, 0.3, 0.14);
    beep(1.04, 880, 0.3, 0.14);
    setTimeout(() => {
      ctx.close().catch(() => {
        /* already closing */
      });
    }, 1600);
  } catch (err) {
    console.warn("[supervisor-alerts] escalation ringtone failed:", err);
  }
}
