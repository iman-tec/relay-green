"use client";

/*
 * Top-level container for the redesigned Department Admin Panel.
 * Single tab for now (Employees). Top bar shows wordmark + tab + user
 * chip + sign-out.
 */

import { TabsHeader, type Tab } from "@/app/_components/admin-v2/TabsHeader";
import { SignOutButton } from "@/app/_components/admin-v2/SignOutButton";
import { UserChip } from "@/app/_components/admin-v2/UserChip";
import { EmployeesTab } from "./EmployeesTab";

type TabKey = "employees";

const TABS: readonly Tab<TabKey>[] = [
  { key: "employees", label: "Employees" },
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
        active="employees"
        onChange={() => { /* single tab */ }}
        rightSlot={
          <div className="flex items-center gap-3">
            <UserChip email={me.email} roleLabel={me.roleLabel} />
            <SignOutButton />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <EmployeesTab />
      </div>
    </div>
  );
}
