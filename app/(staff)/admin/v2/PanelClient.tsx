"use client";

/*
 * Top-level container for the redesigned Superadmin Panel. Owns the
 * tab state, syncs it to ?tab=…, and swaps the body. Lives inside the
 * existing StaffShell (sidebar nav + profile chip stay put above).
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { EnterpriseTab } from "./EnterpriseTab";
import { ResellersTab } from "./ResellersTab";
import { ApplicationsTab } from "./ApplicationsTab";
import { PodsTab } from "./PodsTab";
import { InternalUsersTab } from "./InternalUsersTab";
import { BenchTab } from "./BenchTab";

type TabKey =
  | "enterprise"
  | "reseller"
  | "applications"
  | "pods"
  | "internal"
  | "bench";

const TABS: readonly Tab<TabKey>[] = [
  { key: "reseller", label: "Channel Partners" },
  { key: "applications", label: "Partner Applications" },
  { key: "enterprise", label: "Enterprise" },
  { key: "pods", label: "Pods" },
  { key: "bench", label: "Bench" },
  { key: "internal", label: "Internal Users" },
];

// Landing tab when no ?tab= is present — always the first tab in TABS.
const DEFAULT_TAB: TabKey = TABS[0].key;

export function PanelClient({
  me,
}: {
  me: { email: string; roleLabel: string };
}) {
  const searchParams = useSearchParams();
  const initial = (searchParams?.get("tab") as TabKey) ?? DEFAULT_TAB;
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initial) ? initial : DEFAULT_TAB
  );

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <TabsHeader
        tabs={TABS}
        active={tab}
        onChange={setTab}
        subtitle="Superadmin Panel"
        rightSlot={
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "enterprise" && <EnterpriseTab />}
        {tab === "reseller" && <ResellersTab />}
        {tab === "applications" && <ApplicationsTab />}
        {tab === "pods" && <PodsTab />}
        {tab === "bench" && <BenchTab />}
        {tab === "internal" && <InternalUsersTab />}
      </div>
    </div>
  );
}
