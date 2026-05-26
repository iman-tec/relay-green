"use client";

/*
 * Top-level container for the redesigned Enterprise Admin Panel. Six tabs,
 * all themed (light/dark/espresso) + responsive. Active tab reflected in the
 * URL via ?tab= (TabsHeader). Renders in StaffShell "bare mode" — owns its
 * own header.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { DashboardTab } from "./DashboardTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { MembersTab } from "./MembersTab";
import { WalletTab } from "./WalletTab";
import { UsageTab } from "./UsageTab";
import { BillingTab } from "./BillingTab";
import { SettingsTab } from "./SettingsTab";

type TabKey = "dashboard" | "departments" | "members" | "wallet" | "usage" | "billing" | "settings";

const TABS: readonly Tab<TabKey>[] = [
  { key: "dashboard",   label: "Dashboard" },
  { key: "departments", label: "Departments" },
  { key: "members",     label: "Members" },
  { key: "wallet",      label: "Wallet" },
  { key: "usage",       label: "Usage" },
  { key: "billing",     label: "Billing" },
  { key: "settings",    label: "Settings" },
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
        {active === "dashboard"   && <DashboardTab />}
        {active === "departments" && <DepartmentsTab />}
        {active === "members"     && <MembersTab />}
        {active === "wallet"      && <WalletTab />}
        {active === "usage"       && <UsageTab />}
        {active === "billing"     && <BillingTab />}
        {active === "settings"    && <SettingsTab />}
      </div>
    </div>
  );
}
