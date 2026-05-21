"use client";

/*
 * Top-level container for the redesigned Reseller Panel. Owns the single
 * "Enterprises" tab and mounts the drill-down body. Modeled on the
 * Superadmin /admin/v2 PanelClient, just with one tab instead of four —
 * the reseller's world is entirely their own enterprises.
 *
 * Chrome matches the other v2 panels: subtitle, user chip + sign-out
 * in the right slot.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { EnterpriseTab } from "./EnterpriseTab";

type TabKey = "enterprise";

const TABS: readonly Tab<TabKey>[] = [
  { key: "enterprise", label: "Enterprises" },
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
        subtitle="Reseller Panel"
        rightSlot={
          <div className="flex items-center gap-3">
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "enterprise" && <EnterpriseTab />}
      </div>
    </div>
  );
}
