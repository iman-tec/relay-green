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
import { EnterpriseTab } from "./EnterpriseTab";
import { ResellersTab } from "./ResellersTab";
import { PodsTab } from "./PodsTab";
import { InternalUsersTab } from "./InternalUsersTab";

type TabKey = "enterprise" | "reseller" | "pods" | "internal";

const TABS: readonly Tab<TabKey>[] = [
  { key: "enterprise", label: "Enterprise" },
  { key: "reseller",   label: "Reseller"   },
  { key: "pods",       label: "Pods"       },
  { key: "internal",   label: "Internal Users" },
];

export function PanelClient({
  me,
}: {
  me: { email: string; roleLabel: string };
}) {
  const searchParams = useSearchParams();
  const initial = (searchParams?.get("tab") as TabKey) ?? "enterprise";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initial) ? initial : "enterprise",
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
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "enterprise" && <EnterpriseTab />}
        {tab === "reseller"   && <ResellersTab />}
        {tab === "pods"       && <PodsTab />}
        {tab === "internal"   && <InternalUsersTab />}
      </div>
    </div>
  );
}
