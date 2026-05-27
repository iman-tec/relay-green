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
import { PartnerOverviewTab, type PartnerOverviewView } from "./PartnerOverviewTab";
import { ClientsTab } from "./ClientsTab";
import { PartnerSettingsTab } from "./PartnerSettingsTab";

type TabKey = "dashboard" | "clients" | "settings";

const TABS: readonly Tab<TabKey>[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clients",   label: "Clients" },
  { key: "settings",  label: "Settings" },
];

const VALID = new Set<TabKey>(TABS.map((t) => t.key));

function resolveInitial(param: string | null | undefined): { tab: TabKey; view: PartnerOverviewView } {
  switch (param) {
    case "sales":     return { tab: "dashboard", view: "sales" };
    case "clients":   return { tab: "clients", view: "portfolio" };
    case "settings":  return { tab: "settings", view: "portfolio" };
    case "dashboard":
    default:          return { tab: "dashboard", view: "portfolio" };
  }
}

export function PanelClient({ me }: { me: { email: string; roleLabel: string } }) {
  const searchParams = useSearchParams();
  const initial = resolveInitial(searchParams?.get("tab"));
  const [tab, setTab] = useState<TabKey>(VALID.has(initial.tab) ? initial.tab : "dashboard");

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
        {tab === "dashboard" && <PartnerOverviewTab initialView={initial.view} />}
        {tab === "clients"   && <ClientsTab />}
        {tab === "settings"  && <PartnerSettingsTab />}
      </div>
    </div>
  );
}
