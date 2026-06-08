"use client";

/*
 * Department command center — flag-on bare-mode console. Own rail + ?tab=.
 * Scoped to the one department; read-only on spend. Rail preserves the G2
 * guardrail (Supervise link-out + bell + theme + identity).
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Users, Eye, BarChart3, Settings, BookOpen } from "lucide-react";
import { CommandRail } from "@/app/_components/portal/CommandRail";
import { useDepartment } from "./useDepartment";
import { OverviewView } from "./OverviewView";
import { SuperviseView } from "./SuperviseView";
import { UsageView, SettingsView, ResourcesView } from "./views";
import type { DeptTab } from "./types";

// Settings lives in the bottom account dropdown (alongside Theme + Sign out),
// not the nav — mirrors the enterprise console. Still a valid ?tab= target.
const NAV = [
  { key: "overview", label: "Overview", Icon: Users },
  { key: "supervise", label: "Supervise", Icon: Eye },
  { key: "usage", label: "Usage", Icon: BarChart3 },
  { key: "resources", label: "Resources", Icon: BookOpen },
];

// No external link-outs. The department's live session monitoring lives
// in-console under the Supervise tab — the old "Supervise" link ejected the
// admin into the legacy StaffShell standalone, so it was removed.
const LINKS: { label: string; href: string; Icon: typeof Users }[] = [];

const VALID: DeptTab[] = [
  "overview",
  "supervise",
  "usage",
  "settings",
  "resources",
];

function tabFrom(p: string | null | undefined): DeptTab {
  return VALID.includes((p ?? "") as DeptTab) ? (p as DeptTab) : "overview";
}

export function DeptClient({ me }: { me: { email: string } }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data, loading, error, refetch } = useDepartment();
  const [tab, setTab] = useState<DeptTab>(tabFrom(params?.get("tab")));

  useEffect(() => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (p.get("tab") !== tab) {
      p.set("tab", tab);
      router.replace(`${pathname}?${p}`);
    }
  }, [tab, pathname, router, params]);

  const name = data?.department.name ?? me.email.split("@")[0];

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      <CommandRail
        brandLabel="Department"
        nav={NAV}
        activeKey={tab}
        onSelect={(k) => setTab(k as DeptTab)}
        links={LINKS}
        bellEndpoint="/api/department/notifications"
        bellChannelKey="department"
        identityName={name}
        identityEmail={me.email}
        identitySub="Department admin"
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
            data={data}
            loading={loading}
            error={error}
            onChanged={refetch}
          />
        )}
        {tab === "supervise" && <SuperviseView />}
        {tab === "usage" && <UsageView />}
        {tab === "settings" && <SettingsView data={data} />}
        {tab === "resources" && <ResourcesView />}
      </main>
    </div>
  );
}
