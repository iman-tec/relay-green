"use client";

/*
 * Department Admin Panel — scoped to the manager's single department. Lean
 * tabs: Overview (Dashboard / Team members via segmented switch) · Sessions ·
 * Usage · Settings.
 *
 * Renders INSIDE the StaffShell sidebar (no more bare mode) so the console
 * shares the engineer panel's chrome; this component only owns the
 * engineer-style greeting header + in-page tab strip (see ../enterprise/v2/_kit).
 * Legacy ?tab=members/dashboard deep-links still resolve.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { PanelHeader, useFirstName, type PanelTab } from "@/app/(staff)/enterprise/v2/_kit";
import { DeptOverviewTab, type DeptOverviewView } from "./DeptOverviewTab";
import { SessionsTab } from "./SessionsTab";
import { DeptUsageTab } from "./DeptUsageTab";
import { DeptSettingsTab } from "./DeptSettingsTab";

type TabKey = "overview" | "sessions" | "usage" | "settings";

const TABS: readonly PanelTab<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Sessions" },
  { key: "usage",    label: "Usage" },
  { key: "settings", label: "Settings" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

function resolveInitial(param: string | null | undefined): { tab: TabKey; view: DeptOverviewView } {
  switch (param) {
    case "members":   return { tab: "overview", view: "members" };
    case "dashboard":
    case "overview":  return { tab: "overview", view: "dashboard" };
    case "sessions":  return { tab: "sessions", view: "dashboard" };
    case "usage":     return { tab: "usage", view: "dashboard" };
    case "settings":  return { tab: "settings", view: "dashboard" };
    default:          return { tab: "overview", view: "dashboard" };
  }
}

export function PanelClient({ me }: { me: { email: string; roleLabel: string } }) {
  const pathname = usePathname();
  const params   = useSearchParams();

  // The URL is the single source of truth for the active tab — deep links
  // resolve on mount AND ?tab= changes while mounted are followed.
  const initial = resolveInitial(params?.get("tab"));
  const active: TabKey = VALID.has(initial.tab) ? initial.tab : "overview";

  // Native replaceState keeps a tab click a pure client-side URL swap (no
  // RSC refetch); Next syncs useSearchParams from the history state, which
  // re-renders this component with the new derived `active`.
  const select = (next: TabKey) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    p.set("tab", next);
    window.history.replaceState(null, "", `${pathname}?${p}`);
  };

  const firstName = useFirstName(me.email);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        name={firstName}
        subtitle={`Department console · ${me.roleLabel}`}
        tabs={TABS}
        active={active}
        onChange={select}
        rightSlot={
          <NotificationBell endpoint="/api/department/notifications" channelKey="department" />
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === "overview" && <DeptOverviewTab initialView={initial.view} />}
        {active === "sessions" && <SessionsTab />}
        {active === "usage"    && <DeptUsageTab />}
        {active === "settings" && <DeptSettingsTab />}
      </div>
    </div>
  );
}
