"use client";

/*
 * Top-level container for the Enterprise Admin Panel. Lean tab set:
 *   Overview (Dashboard / Departments / Members via segmented switch)
 *   Usage · Billing (wallet + invoices) · Settings
 *
 * Renders INSIDE the StaffShell sidebar — and the tabs themselves live in
 * that sidebar as ?tab= links (see the enterprise console entries in
 * StaffShell's NAV). This component just reads ?tab= and renders the
 * matching tab body under an engineer-style greeting header; there is no
 * in-page tab strip.
 *
 * Legacy ?tab= deep-links (dashboard, departments, members, wallet) still
 * resolve, and ?tab= changes while mounted are followed (sidebar clicks,
 * the shell profile menu's "Wallet" link).
 */

import { useSearchParams } from "next/navigation";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { PanelHeader, useFirstName } from "./_kit";
import { OverviewTab, type OverviewView } from "./OverviewTab";
import { UsageTab } from "./UsageTab";
import { BillingWalletTab } from "./BillingWalletTab";
import { SettingsTab } from "./SettingsTab";
import { PartnerTermsGate } from "./PartnerTermsGate";
import { enterpriseV2Enabled } from "@/lib/flags";
import { EnterpriseClient } from "./_cc/EnterpriseClient";

type TabKey = "overview" | "usage" | "billing" | "settings";

// Map legacy ?tab= values onto the new structure. Keep in sync with
// enterpriseTabOf in app/_components/StaffShell.tsx (sidebar active state).
function resolveInitial(param: string | null | undefined): {
  tab: TabKey;
  view: OverviewView;
} {
  switch (param) {
    case "departments":
      return { tab: "overview", view: "departments" };
    case "members":
      return { tab: "overview", view: "members" };
    case "dashboard":
    case "overview":
      return { tab: "overview", view: "dashboard" };
    case "wallet":
    case "billing":
      return { tab: "billing", view: "dashboard" };
    case "usage":
      return { tab: "usage", view: "dashboard" };
    case "settings":
      return { tab: "settings", view: "dashboard" };
    default:
      return { tab: "overview", view: "dashboard" };
  }
}

export function PanelClient({
  me,
}: {
  me: { email: string; roleLabel: string };
}) {
  // Command-center redesign behind NEXT_PUBLIC_ENTERPRISE_V2. Off → today's
  // embedded tabs render unchanged. Gate precedes hooks (per-build constant).
  if (enterpriseV2Enabled()) {
    return <EnterpriseClient me={{ email: me.email }} />;
  }
  return <LegacyPanel me={me} />;
}

function LegacyPanel({ me }: { me: { email: string; roleLabel: string } }) {
  const params = useSearchParams();

  // The URL is the single source of truth for the active tab — deep links
  // resolve on mount AND ?tab= changes while mounted are followed (the
  // sidebar items are plain links to /enterprise/v2?tab=…).
  const initial = resolveInitial(params?.get("tab"));
  const active: TabKey = initial.tab;

  const firstName = useFirstName(me.email);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Clickwrap gate — inert unless the partner program is on AND this org
          is a partner-onboarded enterprise still pending acceptance. */}
      <PartnerTermsGate />
      <PanelHeader
        name={firstName}
        rightSlot={
          <NotificationBell
            endpoint="/api/enterprise/notifications"
            channelKey="enterprise"
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === "overview" && <OverviewTab initialView={initial.view} />}
        {active === "usage" && <UsageTab />}
        {active === "billing" && <BillingWalletTab />}
        {active === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
