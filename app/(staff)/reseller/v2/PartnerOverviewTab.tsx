"use client";

/*
 * Overview — folds the partner portfolio dashboard and the sales/acquisition
 * views into one tab via a segmented switch, keeping the panel lean
 * (Overview / Clients / Settings).
 */

import { useState } from "react";
import { Segmented, type Segment } from "@/app/_components/admin-v2/Segmented";
import { PartnerDashboardTab } from "./PartnerDashboardTab";
import { SalesTab } from "./SalesTab";

export type PartnerOverviewView = "portfolio" | "sales";

const SEGMENTS: readonly Segment<PartnerOverviewView>[] = [
  { key: "portfolio", label: "Portfolio" },
  { key: "sales", label: "Sales" },
];

export function PartnerOverviewTab({
  initialView = "portfolio",
}: {
  initialView?: PartnerOverviewView;
}) {
  const [view, setView] = useState<PartnerOverviewView>(initialView);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Segmented
        ariaLabel="Overview sections"
        value={view}
        onChange={setView}
        options={SEGMENTS}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "portfolio" && <PartnerDashboardTab />}
        {view === "sales" && <SalesTab />}
      </div>
    </div>
  );
}
