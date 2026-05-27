"use client";

/*
 * Top-level container for the Enterprise Admin Panel. Lean tab set:
 *   Overview (Dashboard / Departments / Members via segmented switch)
 *   Usage · Billing (wallet + invoices) · Settings
 * Renders in StaffShell "bare mode". Legacy ?tab= deep-links (dashboard,
 * departments, members, wallet) still resolve.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { OverviewTab, type OverviewView } from "./OverviewTab";
import { UsageTab } from "./UsageTab";
import { BillingWalletTab } from "./BillingWalletTab";
import { SettingsTab } from "./SettingsTab";

type TabKey = "overview" | "usage" | "billing" | "settings";

const TABS: readonly Tab<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "usage",    label: "Usage" },
  { key: "billing",  label: "Billing" },
  { key: "settings", label: "Settings" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

// Map legacy ?tab= values onto the new structure.
function resolveInitial(param: string | null | undefined): { tab: TabKey; view: OverviewView } {
  switch (param) {
    case "departments": return { tab: "overview", view: "departments" };
    case "members":     return { tab: "overview", view: "members" };
    case "dashboard":
    case "overview":    return { tab: "overview", view: "dashboard" };
    case "wallet":
    case "billing":     return { tab: "billing", view: "dashboard" };
    case "usage":       return { tab: "usage", view: "dashboard" };
    case "settings":    return { tab: "settings", view: "dashboard" };
    default:            return { tab: "overview", view: "dashboard" };
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
        subtitle="Enterprise"
        rightSlot={
          <div className="flex items-center gap-2">
            <ThemeTriplet />
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === "overview" && <OverviewTab initialView={initial.view} />}
        {active === "usage"     && <UsageTab />}
        {active === "billing"   && <BillingWalletTab />}
        {active === "settings"  && <SettingsTab />}
      </div>
    </div>
  );
}
