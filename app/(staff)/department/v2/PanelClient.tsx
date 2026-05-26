"use client";

/*
 * Department Admin Panel — scoped to the manager's single department. Five
 * tabs, all themed (light/dark/espresso) + responsive. StaffShell bare mode
 * (owns its own header). No org-wide billing, no other departments, no
 * privacy/erasure controls — those belong to the enterprise admin.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { DeptDashboardTab } from "./DeptDashboardTab";
import { EmployeesTab } from "./EmployeesTab";
import { SessionsTab } from "./SessionsTab";
import { DeptUsageTab } from "./DeptUsageTab";
import { DeptSettingsTab } from "./DeptSettingsTab";

type TabKey = "dashboard" | "members" | "sessions" | "usage" | "settings";

const TABS: readonly Tab<TabKey>[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members",   label: "Team members" },
  { key: "sessions",  label: "Sessions" },
  { key: "usage",     label: "Usage" },
  { key: "settings",  label: "Settings" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

export function PanelClient({ me }: { me: { email: string; roleLabel: string } }) {
  const params = useSearchParams();
  const initial = params?.get("tab");
  const [active, setActive] = useState<TabKey>(
    initial && VALID.has(initial as TabKey) ? (initial as TabKey) : "dashboard",
  );

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TabsHeader
        tabs={TABS}
        active={active}
        onChange={setActive}
        subtitle="Department"
        rightSlot={
          <div className="flex items-center gap-2">
            <ThemeTriplet />
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === "dashboard" && <DeptDashboardTab />}
        {active === "members"   && <EmployeesTab />}
        {active === "sessions"  && <SessionsTab />}
        {active === "usage"     && <DeptUsageTab />}
        {active === "settings"  && <DeptSettingsTab />}
      </div>
    </div>
  );
}
