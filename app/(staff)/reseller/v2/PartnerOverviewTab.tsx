"use client";

/*
 * Overview — folds the partner portfolio dashboard and the sales/acquisition
 * views into one section. The Portfolio/Sales switch lives in the page top bar
 * (browser-style tabs in PanelClient); this component is now a controlled
 * renderer that shows whichever view is selected.
 */

import { PartnerDashboardTab } from "./PartnerDashboardTab";
import { SalesTab } from "./SalesTab";

export type PartnerOverviewView = "portfolio" | "sales";

export function PartnerOverviewTab({ view }: { view: PartnerOverviewView }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "portfolio" && <PartnerDashboardTab />}
        {view === "sales" && <SalesTab />}
      </div>
    </div>
  );
}
