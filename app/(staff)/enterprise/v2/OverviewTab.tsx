"use client";

/*
 * Overview — folds Dashboard, Departments and Members into one top-level tab
 * via a segmented switch, so the enterprise panel stays lean (Overview /
 * Usage / Billing / Settings).
 */

import { useState } from "react";
import { Segmented, type Segment } from "@/app/_components/admin-v2/Segmented";
import { DashboardTab } from "./DashboardTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { MembersTab } from "./MembersTab";

export type OverviewView = "dashboard" | "departments" | "members";

const SEGMENTS: readonly Segment<OverviewView>[] = [
  { key: "dashboard",   label: "Dashboard" },
  { key: "departments", label: "Departments" },
  { key: "members",     label: "Members" },
];

export function OverviewTab({ initialView = "dashboard" }: { initialView?: OverviewView }) {
  const [view, setView] = useState<OverviewView>(initialView);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Segmented ariaLabel="Overview sections" value={view} onChange={setView} options={SEGMENTS} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "dashboard"   && <DashboardTab />}
        {view === "departments" && <DepartmentsTab />}
        {view === "members"     && <MembersTab />}
      </div>
    </div>
  );
}
