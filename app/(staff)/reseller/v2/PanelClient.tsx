"use client";

/*
 * Channel Partner Panel (formerly "Reseller"). Four tabs, all themed
 * (light/dark/espresso) + responsive, StaffShell bare mode. Everything the
 * partner sees is aggregate-only — no client member names, emails, or
 * individual usage (GDPR data minimization).
 *
 * Note: the route segment + role token remain `reseller` internally; only
 * the user-facing language is "Channel Partner".
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { PartnerDashboardTab } from "./PartnerDashboardTab";
import { ClientsTab } from "./ClientsTab";
import { RevenueTab } from "./RevenueTab";
import { PartnerSettingsTab } from "./PartnerSettingsTab";

type TabKey = "dashboard" | "clients" | "revenue" | "settings";

const TABS: readonly Tab<TabKey>[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clients",   label: "Clients" },
  { key: "revenue",   label: "Revenue" },
  { key: "settings",  label: "Settings" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

export function PanelClient({ me }: { me: { email: string; roleLabel: string } }) {
  const searchParams = useSearchParams();
  const initial = searchParams?.get("tab");
  const [tab, setTab] = useState<TabKey>(
    initial && VALID.has(initial as TabKey) ? (initial as TabKey) : "dashboard",
  );

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TabsHeader
        tabs={TABS}
        active={tab}
        onChange={setTab}
        subtitle="Channel Partner"
        rightSlot={
          <div className="flex items-center gap-2">
            <ThemeTriplet />
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "dashboard" && <PartnerDashboardTab />}
        {tab === "clients"   && <ClientsTab />}
        {tab === "revenue"   && <RevenueTab />}
        {tab === "settings"  && <PartnerSettingsTab />}
      </div>
    </div>
  );
}
