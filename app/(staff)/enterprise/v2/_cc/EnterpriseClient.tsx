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
  BarChart3,
  Users,
  Settings,
  BookOpen,
  Eye,
  Banknote,
} from "lucide-react";
import { CommandRail } from "@/app/_components/portal/CommandRail";
import { PartnerTermsGate } from "@/app/(staff)/enterprise/v2/PartnerTermsGate";
import { EnterpriseMsaGate } from "./EnterpriseMsaGate";
import { useEnterprise } from "./useEnterprise";
import { OverviewView } from "./OverviewView";
import { RechargeView } from "./RechargeView";
import { MembersView, UsageView, SettingsView, ResourcesView } from "./views";
import type { EntTab } from "./types";

const NAV = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "recharge", label: "Recharge", Icon: Wallet },
  { key: "usage", label: "Usage", Icon: BarChart3 },
  { key: "members", label: "Members", Icon: Users },
  { key: "settings", label: "Settings", Icon: Settings },
  { key: "resources", label: "Resources", Icon: BookOpen },
];

const LINKS = [
  { label: "Supervise", href: "/supervise", Icon: Eye },
  { label: "Finance", href: "/finance", Icon: Banknote },
];

const VALID: EntTab[] = [
  "overview",
  "recharge",
  "usage",
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
        {tab === "usage" && <UsageView />}
        {tab === "members" && <MembersView />}
        {tab === "settings" && <SettingsView me={data} onChanged={refetch} />}
        {tab === "resources" && <ResourcesView />}
      </main>
    </div>
  );
}
