"use client";

/*
 * Overview — folds the department Dashboard and Team members into one tab via
 * a segmented switch, keeping the panel lean (Overview / Sessions / Usage /
 * Settings).
 */

import { useState } from "react";
import { Segmented, type Segment } from "@/app/_components/admin-v2/Segmented";
import { DeptDashboardTab } from "./DeptDashboardTab";
import { EmployeesTab } from "./EmployeesTab";

export type DeptOverviewView = "dashboard" | "members";

const SEGMENTS: readonly Segment<DeptOverviewView>[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members",   label: "Team members" },
];

export function DeptOverviewTab({ initialView = "dashboard" }: { initialView?: DeptOverviewView }) {
  const [view, setView] = useState<DeptOverviewView>(initialView);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Segmented ariaLabel="Overview sections" value={view} onChange={setView} options={SEGMENTS} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "dashboard" && <DeptDashboardTab />}
        {view === "members"   && <EmployeesTab />}
      </div>
    </div>
  );
}
