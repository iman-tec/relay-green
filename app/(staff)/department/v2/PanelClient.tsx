"use client";

/*
 * Department Admin Panel — scoped to the manager's single department. Lean
 * tabs: Overview (Dashboard / Team members via segmented switch) · Sessions ·
 * Usage · Settings.
 *
 * Renders INSIDE the StaffShell sidebar — and the tabs themselves live in
 * that sidebar as ?tab= links (see the department console entries in
 * StaffShell's NAV). This component just reads ?tab= and renders the
 * matching tab body under the greeting header; there is no in-page tab
 * strip. Legacy ?tab=members/dashboard deep-links still resolve.
 */

import { useSearchParams } from "next/navigation";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { PanelHeader, useFirstName } from "@/app/(staff)/enterprise/v2/_kit";
import { DeptOverviewTab, type DeptOverviewView } from "./DeptOverviewTab";
import { SessionsTab } from "./SessionsTab";
import { DeptUsageTab } from "./DeptUsageTab";
import { DeptSettingsTab } from "./DeptSettingsTab";

type TabKey = "overview" | "sessions" | "usage" | "settings";

// Map legacy ?tab= values onto the new structure. Keep in sync with
// departmentTabOf in app/_components/StaffShell.tsx (sidebar active state).
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
  const params = useSearchParams();

  // The URL is the single source of truth for the active tab — deep links
  // resolve on mount AND ?tab= changes while mounted are followed (the
  // sidebar items are plain links to /department/v2?tab=…).
  const initial = resolveInitial(params?.get("tab"));
  const active: TabKey = initial.tab;

  const firstName = useFirstName(me.email);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        name={firstName}
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
