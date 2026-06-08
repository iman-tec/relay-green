"use client";

/*
 * Command-center rail: the left nav (Overview · Onboard · Program · Resources ·
 * Help), the shared ThemeTriplet switcher (consistent with every other staff
 * surface), and the partner identity foot. Mirrors ResellerSidebar's visual
 * language; the portal is bare-mode full-bleed so this IS the only sidebar.
 */

import {
  LayoutDashboard,
  Plus,
  UserPlus,
  BadgeCheck,
  BookOpen,
  Settings,
  HelpCircle,
} from "lucide-react";
import { AccountMenu } from "@/app/_components/portal/AccountMenu";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import type { PortalTab } from "./types";

const NAV: { key: PortalTab; label: string; Icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "onboard", label: "Onboard", Icon: Plus },
  // Individual referrals — distinct from the enterprise companies table.
  ...(partnerProgramEnabled()
    ? [
        {
          key: "referrals" as PortalTab,
          label: "Individual referrals",
          Icon: UserPlus,
        },
      ]
    : []),
  { key: "program", label: "Program", Icon: BadgeCheck },
  { key: "resources", label: "Resources", Icon: BookOpen },
  { key: "settings", label: "Settings", Icon: Settings },
  { key: "help", label: "Help", Icon: HelpCircle },
];

export function PortalSidebar({
  active,
  onChange,
  partnerName,
  partnerEmail,
  tierLabel,
}: {
  active: PortalTab;
  onChange: (t: PortalTab) => void;
  partnerName: string;
  partnerEmail?: string;
  tierLabel: string;
}) {
  return (
    <aside
      className="flex w-[232px] shrink-0 flex-col border-r p-3"
      style={{
        background: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-4">
        <span
          className="size-2.5 rounded-full"
          style={{ background: "var(--primary)" }}
        />
        <span className="text-[15px] font-semibold">Relay</span>
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          Partners
        </span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ key, label, Icon }) => {
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={on ? "page" : undefined}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors"
              style={{
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--text)" : "var(--text-muted)",
                boxShadow: on ? "0 1px 2px rgba(20,23,26,.04)" : undefined,
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto">
        <AccountMenu
          name={partnerName}
          email={partnerEmail}
          sub={`${tierLabel} partner`}
        />
      </div>
    </aside>
  );
}
