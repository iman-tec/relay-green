"use client";

/*
 * CommandRail — the shared bare-mode left rail for the v2 command centers
 * (reseller / enterprise / department). Generalizes the reseller PortalSidebar:
 *
 *   - in-console nav (buttons → onSelect, ?tab=-driven by the caller)
 *   - external link-outs (real <a href> to StaffShell routes the bare console
 *     would otherwise hide — e.g. Supervise, Finance). THE G2 GUARDRAIL: the
 *     rail must preserve every nav StaffShell gives these admins.
 *   - NotificationBell (endpoint per surface)
 *   - ThemeTriplet (consistent theme switcher)
 *   - identity foot (name + subtitle + initials)
 */

import type { ComponentType } from "react";
import { NotificationBell } from "@/app/_components/admin-v2/NotificationBell";
import { AccountMenu, type AccountMenuItem } from "./AccountMenu";

type IconType = ComponentType<{ size?: number }>;

export type RailNav = { key: string; label: string; Icon: IconType };
export type RailLink = { label: string; href: string; Icon: IconType };

export function CommandRail({
  brandLabel,
  nav,
  activeKey,
  onSelect,
  links = [],
  bellEndpoint,
  bellChannelKey,
  identityName,
  identityEmail,
  identitySub,
  accountItems = [],
}: {
  brandLabel: string;
  nav: RailNav[];
  activeKey: string;
  onSelect: (key: string) => void;
  links?: RailLink[];
  bellEndpoint: string;
  bellChannelKey: string;
  identityName: string;
  identityEmail?: string;
  identitySub: string;
  /** Extra actions in the bottom account dropdown (e.g. Settings). */
  accountItems?: AccountMenuItem[];
}) {
  return (
    <aside
      className="flex w-[232px] shrink-0 flex-col border-r p-3"
      style={{
        background: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-4">
        <div className="flex items-center gap-2.5">
          <span
            className="size-2.5 rounded-full"
            style={{ background: "var(--primary)" }}
          />
          <span className="text-[15px] font-semibold">Relay</span>
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {brandLabel}
          </span>
        </div>
        {/* align="left": the bell lives in the LEFT rail, so the dropdown must
            open rightward into the content area. Without this it defaults to
            right-edge anchoring and clips off the screen (S1). */}
        <NotificationBell
          endpoint={bellEndpoint}
          channelKey={bellChannelKey}
          align="left"
        />
      </div>

      <nav className="flex flex-col gap-0.5">
        {nav.map(({ key, label, Icon }) => {
          const on = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
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

      {links.length > 0 && (
        <div
          className="mt-3 flex flex-col gap-0.5 border-t pt-3"
          style={{ borderColor: "var(--border)" }}
        >
          {links.map(({ label, href, Icon }) => (
            <a
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium no-underline transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--text)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--text-muted)")
              }
            >
              <Icon size={16} />
              {label}
              <span aria-hidden className="ml-auto text-[11px] opacity-60">
                ↗
              </span>
            </a>
          ))}
        </div>
      )}

      <div className="mt-auto">
        <AccountMenu
          name={identityName}
          email={identityEmail}
          sub={identitySub}
          items={accountItems}
        />
      </div>
    </aside>
  );
}
