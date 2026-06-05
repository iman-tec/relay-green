"use client";

/*
 * Channel Partner Panel (formerly "Reseller"). Three sections — Dashboard,
 * Clients, Settings — navigated from a left sidebar that mirrors the
 * engineer/customer shell (StaffShell). Each section's sub-views (Dashboard:
 * Portfolio/Sales · Clients: Clients/Invitations) are surfaced as browser-style
 * tabs in the page top bar, aligned with the notification bell — not as in-page
 * pills. Everything the partner sees is aggregate-only (GDPR data minimization).
 *
 * Note: the route segment + role token remain `reseller` internally; only the
 * user-facing language is "Channel Partner".
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { ResellerSidebar, type ResellerTabKey } from "./ResellerSidebar";
import {
  PartnerOverviewTab,
  type PartnerOverviewView,
} from "./PartnerOverviewTab";
import { ClientsTab, type ClientsView } from "./ClientsTab";
import { PartnerSettingsTab } from "./PartnerSettingsTab";

const VALID = new Set<ResellerTabKey>(["dashboard", "clients", "settings"]);

function resolveInitial(param: string | null | undefined): {
  tab: ResellerTabKey;
  view: PartnerOverviewView;
} {
  switch (param) {
    case "sales":
      return { tab: "dashboard", view: "sales" };
    case "clients":
      return { tab: "clients", view: "portfolio" };
    case "settings":
      return { tab: "settings", view: "portfolio" };
    case "dashboard":
    default:
      return { tab: "dashboard", view: "portfolio" };
  }
}

type SubTab = { key: string; label: string };

export function PanelClient({
  me,
}: {
  me: { email: string; roleLabel: string };
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initial = resolveInitial(searchParams?.get("tab"));
  const [tab, setTab] = useState<ResellerTabKey>(
    VALID.has(initial.tab) ? initial.tab : "dashboard"
  );
  // Per-section sub-view, lifted here so the top-bar tabs (which render the
  // switch) and the content (which renders the selected view) stay in sync.
  const [dashView, setDashView] = useState<PartnerOverviewView>(
    initial.view === "sales" ? "sales" : "portfolio"
  );
  const [cliView, setCliView] = useState<ClientsView>("clients");

  // Keep ?tab=… in sync with the active section so reloads + deep-links work.
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (params.get("tab") !== tab) {
      params.set("tab", tab);
      router.replace(`${pathname}?${params}`);
    }
  }, [tab, pathname, router, searchParams]);

  // Browser-style sub-tabs for the active section (empty for Settings).
  const subTabs: SubTab[] =
    tab === "dashboard"
      ? [
          { key: "portfolio", label: "Portfolio" },
          { key: "sales", label: "Sales" },
        ]
      : tab === "clients"
        ? [
            { key: "clients", label: "Enterprises" },
            { key: "invitations", label: "Invitations" },
          ]
        : [];
  const activeSub =
    tab === "dashboard" ? dashView : tab === "clients" ? cliView : "";
  const onSub = (k: string) => {
    if (tab === "dashboard") setDashView(k as PartnerOverviewView);
    else if (tab === "clients") setCliView(k as ClientsView);
  };

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      <ResellerSidebar active={tab} onChange={setTab} me={me} />
      {/* On mobile/tablet the rail is a fixed overlay drawer, so it leaves the
          flex flow — reserve the 60px collapsed-rail width here so content
          isn't hidden behind it. At `lg`+ the rail is in-flow. */}
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden pl-[60px] lg:pl-0">
        {/* Top bar — browser-style section tabs (left) + notifications (right).
            Tabs sit on the strip's bottom line; the active one overlaps it
            (margin-bottom -1px) so it reads as a connected browser tab. */}
        <div
          className="relative flex shrink-0 items-end justify-between gap-3 px-4 pt-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div role="tablist" className="flex items-end gap-1">
            {subTabs.map((t) => {
              const active = activeSub === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSub(t.key)}
                  className="relative flex items-center gap-2 rounded-t-xl border border-b-0 px-5 py-2.5 text-sm transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    background: active
                      ? "var(--surface)"
                      : "var(--surface-raised)",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    fontWeight: active ? 600 : 500,
                    marginBottom: active ? -1 : 0,
                    zIndex: active ? 3 : 1,
                    boxShadow: active
                      ? "0 -3px 8px -6px rgba(26,37,32,0.25)"
                      : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-block size-[7px] rounded-full transition-colors"
                    style={{
                      background: active ? "var(--ok)" : "var(--text-faint)",
                    }}
                  />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="pb-2">
            <NotificationBell clearable />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {tab === "dashboard" && <PartnerOverviewTab view={dashView} />}
          {tab === "clients" && <ClientsTab view={cliView} />}
          {tab === "settings" && <PartnerSettingsTab />}
        </div>
      </main>
    </div>
  );
}
