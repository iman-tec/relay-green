"use client";

/*
 * Enterprise command center — the flag-on bare-mode console. Own rail
 * (CommandRail) + one content region by ?tab=. Data polls (useEnterprise).
 * The rail preserves the G2 guardrail: external link-outs to /supervise and
 * /finance (which render in StaffShell), plus the bell + theme + identity.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  Users,
  Settings,
  BookOpen,
  Banknote,
} from "lucide-react";
import { CommandRail } from "@/app/_components/portal/CommandRail";
import { PartnerTermsGate } from "@/app/(staff)/enterprise/v2/PartnerTermsGate";
import { EnterpriseMsaGate } from "./EnterpriseMsaGate";
import { useEnterprise } from "./useEnterprise";
import { OverviewView } from "./OverviewView";
import { RechargeView } from "./RechargeView";
import { FinanceView } from "./FinanceView";
import { MembersView, SettingsView, ResourcesView } from "./views";
import type { EntTab } from "./types";

// Usage merged into Finance (revenue + usage). Settings lives in the bottom
// account dropdown, not the nav. Supervise is a department-only surface — the
// enterprise admin manages via Overview/Members, not a live session view.
const NAV = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "recharge", label: "Recharge", Icon: Wallet },
  { key: "finance", label: "Finance", Icon: Banknote },
  { key: "members", label: "Members", Icon: Users },
  { key: "resources", label: "Resources", Icon: BookOpen },
];

// No external link-outs. Supervise and Finance are now in-console tabs above —
// neither is a /supervise or /finance link-out that ejected the admin into the
// legacy StaffShell.
const LINKS: { label: string; href: string; Icon: typeof Wallet }[] = [];

const VALID: EntTab[] = [
  "overview",
  "recharge",
  "finance",
  "members",
  "settings",
  "resources",
];

function tabFrom(p: string | null | undefined): EntTab {
  return VALID.includes((p ?? "") as EntTab) ? (p as EntTab) : "overview";
}

export function EnterpriseClient({ me }: { me: { email: string } }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me: data, depts, wallet, loading, error, refetch } = useEnterprise();
  const [tab, setTab] = useState<EntTab>(tabFrom(params?.get("tab")));

  useEffect(() => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (p.get("tab") !== tab) {
      p.set("tab", tab);
      router.replace(`${pathname}?${p}`);
    }
  }, [tab, pathname, router, params]);

  const goRecharge = useCallback(() => setTab("recharge"), []);

  const name = data?.org.name ?? me.email.split("@")[0];

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      <EnterpriseMsaGate />
      <PartnerTermsGate />
      <CommandRail
        brandLabel="Enterprise"
        nav={NAV}
        activeKey={tab}
        onSelect={(k) => setTab(k as EntTab)}
        links={LINKS}
        bellEndpoint="/api/enterprise/notifications"
        bellChannelKey="enterprise"
        identityName={name}
        identityEmail={me.email}
        identitySub="Enterprise admin"
        accountItems={[
          {
            label: "Settings",
            Icon: Settings,
            onClick: () => setTab("settings"),
          },
        ]}
      />
      <main className="min-w-0 flex-1 overflow-auto">
        {tab === "overview" && (
          <OverviewView
            me={data}
            depts={depts}
            loading={loading}
            error={error}
            onRecharge={goRecharge}
            onChanged={refetch}
          />
        )}
        {tab === "recharge" && (
          <RechargeView me={data} wallet={wallet} onCredited={refetch} />
        )}
        {tab === "finance" && <FinanceView />}
        {tab === "members" && <MembersView />}
        {tab === "settings" && <SettingsView me={data} onChanged={refetch} />}
        {tab === "resources" && <ResourcesView />}
      </main>
    </div>
  );
}
