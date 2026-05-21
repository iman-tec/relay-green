"use client";

/*
 * Top-level container for the redesigned Enterprise Admin Panel.
 * Single tab for now (Departments). Top bar shows wordmark + tab +
 * user chip + sign-out.
 */

import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { DepartmentsTab } from "./DepartmentsTab";

type TabKey = "departments";

const TABS: readonly Tab<TabKey>[] = [
  { key: "departments", label: "Departments" },
];

export function PanelClient({
  me,
}: {
  me: { email: string; roleLabel: string };
}) {
  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <TabsHeader
        tabs={TABS}
        active="departments"
        onChange={() => { /* only one tab — no-op */ }}
        rightSlot={
          <div className="flex items-center gap-3">
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <DepartmentsTab />
      </div>
    </div>
  );
}
