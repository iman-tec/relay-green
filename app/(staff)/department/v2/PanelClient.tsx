"use client";

/*
 * Department Admin Panel — scoped to the manager's single department. Lean
 * tabs: Overview (Dashboard / Team members via segmented switch) · Sessions ·
 * Usage · Settings. StaffShell bare mode. Legacy ?tab=members/dashboard
 * deep-links still resolve.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { DeptOverviewTab, type DeptOverviewView } from "./DeptOverviewTab";
import { SessionsTab } from "./SessionsTab";
import { DeptUsageTab } from "./DeptUsageTab";
import { DeptSettingsTab } from "./DeptSettingsTab";

type TabKey = "overview" | "sessions" | "usage" | "settings";

const TABS: readonly Tab<TabKey>[] = [
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
  const params = useSearchParams();
  const initial = resolveInitial(params?.get("tab"));
  const [active, setActive] = useState<TabKey>(VALID.has(initial.tab) ? initial.tab : "overview");

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TabsHeader
        tabs={TABS}
        active={active}
        onChange={setActive}
        subtitle="Department"
        rightSlot={
          <div className="flex items-center gap-2">
            <NotificationBell endpoint="/api/department/notifications" channelKey="department" />
            <ThemeTriplet />
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
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
