"use client";

/*
 * Channel Partner command center — the flag-gated v2 portal. Bare-mode
 * full-bleed: own rail (PortalSidebar) + one content region that swaps the
 * active view. ?tab= keeps deep-links + reloads honest. Data is fetched once
 * (usePortal) and shared; Onboard refetches on success.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TIER_LABEL, type PartnerTier } from "@/lib/billing/partnerTiers";
import type { PortalTab } from "./types";
import { usePortal } from "./usePortal";
import { PortalSidebar } from "./PortalSidebar";
import { OverviewView } from "./OverviewView";
import { OnboardView } from "./OnboardView";
import { ProgramView } from "./ProgramView";
import { ResourcesView } from "./ResourcesView";
import { HelpView } from "./HelpView";

const VALID: PortalTab[] = [
  "overview",
  "onboard",
  "program",
  "resources",
  "help",
];

function tabFrom(param: string | null | undefined): PortalTab {
  return VALID.includes((param ?? "") as PortalTab)
    ? (param as PortalTab)
    : "overview";
}

export function PortalClient({ me }: { me: { email: string } }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data, loading, error, refetch } = usePortal();

  const [tab, setTab] = useState<PortalTab>(tabFrom(params?.get("tab")));

  // Keep ?tab= in sync so reloads + deep-links land on the right view.
  useEffect(() => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (p.get("tab") !== tab) {
      p.set("tab", tab);
      router.replace(`${pathname}?${p}`);
    }
  }, [tab, pathname, router, params]);

  const goProgram = useCallback(() => setTab("program"), []);
  const onOnboarded = useCallback(() => {
    void refetch();
    setTab("overview");
  }, [refetch]);

  const partnerName = data?.reseller.name ?? me.email.split("@")[0];
  const tierLabel =
    TIER_LABEL[(data?.reseller.tier as PartnerTier) ?? "partner"];

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      <PortalSidebar
        active={tab}
        onChange={setTab}
        partnerName={partnerName}
        tierLabel={tierLabel}
      />
      <main className="min-w-0 flex-1 overflow-auto">
        {tab === "overview" && (
          <OverviewView
            data={data}
            loading={loading}
            error={error}
            onOnboard={() => setTab("onboard")}
            onProgram={goProgram}
          />
        )}
        {tab === "onboard" && <OnboardView data={data} onDone={onOnboarded} />}
        {tab === "program" && <ProgramView data={data} />}
        {tab === "resources" && <ResourcesView data={data} />}
        {tab === "help" && <HelpView />}
      </main>
    </div>
  );
}
