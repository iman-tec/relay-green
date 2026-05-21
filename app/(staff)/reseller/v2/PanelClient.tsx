"use client";

/*
 * Top-level container for the redesigned Reseller Panel. Owns the single
 * "Enterprises" tab and mounts the drill-down body. Modeled on the
 * Superadmin /admin/v2 PanelClient, just with one tab instead of four —
 * the reseller's world is entirely their own enterprises.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { EnterpriseTab } from "./EnterpriseTab";

type TabKey = "enterprise";

const TABS: readonly Tab<TabKey>[] = [
  { key: "enterprise", label: "Enterprises" },
];

export function PanelClient() {
  const searchParams = useSearchParams();
  const initial = (searchParams?.get("tab") as TabKey) ?? "enterprise";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initial) ? initial : "enterprise",
  );

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <TabsHeader tabs={TABS} active={tab} onChange={setTab} subtitle="Reseller Panel" />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "enterprise" && <EnterpriseTab />}
      </div>
    </div>
  );
}
