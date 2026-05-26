"use client";

/*
 * Channel Partner Dashboard — portfolio overview. Aggregate-only: number of
 * enterprises, total seats/minutes across portfolio, commission, enterprises
 * by status. No member PII anywhere (the partner is a third party).
 */

import { Building2, Timer, Percent, CheckCircle2 } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import {
  useApiData, num, TabBody, StatCard, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Dashboard = {
  reseller: {
    name: string; resellerCode: string; commission: number; status: string;
    allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
    totalEnterprises: number; activeEnterprises: number;
  };
  enterprises: Array<{
    id: string; name: string; enterpriseCode: string; status: string;
    allocatedMinutes: number; usedMinutes: number; createdAt: string;
  }>;
};

const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  active: "ok", onboarding: "warn", churned: "neutral", suspended: "neutral",
};

export function PartnerDashboardTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>("/api/reseller/dashboard");
  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const r = data?.reseller;
  const ents = data?.enterprises ?? [];

  return (
    <TabBody>
      <h1 className="mb-1 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>
        {r?.name ?? "Channel Partner"}
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Portfolio overview · code {r?.resellerCode}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={<Building2 size={16} />} value={num(r?.totalEnterprises)} label="Enterprises" hint={`${num(r?.activeEnterprises)} active`} />
        <StatCard icon={<Timer size={16} />} value={`${num(r?.usedMinutes)}m`} label="Minutes used (portfolio)" />
        <StatCard icon={<Timer size={16} />} value={`${num(r?.allocatedMinutes)}m`} label="Minutes allocated" />
        <StatCard icon={<Percent size={16} />} value={`${num(r?.commission)}%`} label="Commission rate" />
      </div>

      <section className="mt-6 rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Enterprises by status</h2>
          <CheckCircle2 size={14} style={{ color: "var(--text-muted)" }} />
        </header>
        {ents.length === 0 ? (
          <div className="p-6"><EmptyState compact title="No enterprises yet" body="Provision your first client from the Onboarding action." /></div>
        ) : (
          <ul>
            {ents.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>{e.name}</div>
                  <div className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {num(e.usedMinutes)}/{num(e.allocatedMinutes)}m · since {new Date(e.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <StatusBadge compact tone={TONE[e.status] ?? "neutral"}>{e.status}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </TabBody>
  );
}
