"use client";

/*
 * Channel Partner Dashboard — portfolio overview in MONEY terms: companies
 * onboarded, how much each is spending, and the partner's commission. No
 * allocation (minute pools), no departments, no member detail.
 */

import { Building2, Euro, Percent, Wallet } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import {
  useApiData,
  eur,
  num,
  TabBody,
  StatCard,
  LoadingState,
  ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Dashboard = {
  reseller: {
    name: string;
    resellerCode: string;
    commission: number;
    status: string;
    totalEnterprises: number;
    activeEnterprises: number;
  };
  enterprises: Array<{
    id: string;
    name: string;
    status: string;
    usedMinutes: number;
    createdAt: string;
  }>;
};

const CENTS_PER_MINUTE = 300;
const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  active: "ok",
  onboarding: "warn",
  churned: "neutral",
  suspended: "neutral",
};

export function PartnerDashboardTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>(
    "/api/reseller/dashboard"
  );
  if (loading)
    return (
      <TabBody>
        <LoadingState />
      </TabBody>
    );
  if (error)
    return (
      <TabBody>
        <ErrorState message={error} onRetry={reload} />
      </TabBody>
    );
  const r = data?.reseller;
  const ents = data?.enterprises ?? [];
  const commissionPct = (r?.commission ?? 0) / 100;
  const spend = (mins: number) => mins * CENTS_PER_MINUTE;
  const totalSpend = ents.reduce((s, e) => s + spend(e.usedMinutes), 0);
  const totalCommission = Math.round(totalSpend * commissionPct);

  return (
    <TabBody>
      <h1
        className="mb-1 font-serif text-2xl font-medium"
        style={{ color: "var(--text)" }}
      >
        {r?.name ?? "Channel Partner"}
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Portfolio overview · code {r?.resellerCode}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Building2 size={16} />}
          value={num(r?.totalEnterprises)}
          label="Companies"
          hint={`${num(r?.activeEnterprises)} active`}
        />
        <StatCard
          icon={<Euro size={16} />}
          value={eur(totalSpend)}
          label="Portfolio spend"
        />
        <StatCard
          icon={<Percent size={16} />}
          value={`${num(r?.commission)}%`}
          label="Commission rate"
        />
        <StatCard
          icon={<Wallet size={16} />}
          value={eur(totalCommission)}
          label="Commission (est.)"
        />
      </div>

      <section
        className="mt-6 rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            Companies by spend
          </h2>
          <Euro size={14} style={{ color: "var(--text-muted)" }} />
        </header>
        {ents.length === 0 ? (
          <div className="p-6">
            <EmptyState
              compact
              title="No companies yet"
              body="Onboard a company from the Clients tab."
            />
          </div>
        ) : (
          <ul>
            {[...ents]
              .sort((a, b) => b.usedMinutes - a.usedMinutes)
              .map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm"
                      style={{ color: "var(--text)" }}
                    >
                      {e.name}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      since {new Date(e.createdAt).toLocaleDateString()} ·
                      commission{" "}
                      {eur(Math.round(spend(e.usedMinutes) * commissionPct))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-sm tabular-nums"
                      style={{ color: "var(--text)" }}
                    >
                      {eur(spend(e.usedMinutes))}
                    </div>
                    <StatusBadge compact tone={TONE[e.status] ?? "neutral"}>
                      {e.status}
                    </StatusBadge>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </TabBody>
  );
}
