"use client";

/*
 * Revenue / Commission — the Channel Partner's own earnings. Derived from
 * portfolio minutes × per-minute rate × commission. Aggregate-only; no client
 * member data.
 *
 * TODO(api): real payout history + statements need a billing ledger. Numbers
 * here are derived from usage (synthetic €3/min) until that lands.
 */

import { Percent, Wallet, TrendingUp } from "lucide-react";
import { EmptyState } from "@/app/_components/ui";
import {
  useApiData, eur, num, TabBody, StatCard, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Dashboard = {
  reseller: { commission: number; usedMinutes: number; allocatedMinutes: number; totalEnterprises: number };
  enterprises: Array<{ id: string; name: string; usedMinutes: number }>;
};

const CENTS_PER_MINUTE = 300;

export function RevenueTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>("/api/reseller/dashboard");
  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const r = data?.reseller;
  const commissionPct = (r?.commission ?? 0) / 100;
  const grossCents = (r?.usedMinutes ?? 0) * CENTS_PER_MINUTE;
  const commissionCents = Math.round(grossCents * commissionPct);

  const perEnterprise = [...(data?.enterprises ?? [])]
    .sort((a, b) => b.usedMinutes - a.usedMinutes);

  return (
    <TabBody>
      <h1 className="mb-1 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Revenue & commission</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {/* TODO(api): synthetic until a real payout ledger exists */}
        Estimated from portfolio usage at €{(CENTS_PER_MINUTE / 100).toFixed(2)}/min.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard icon={<TrendingUp size={16} />} value={eur(grossCents)} label="Portfolio gross" />
        <StatCard icon={<Percent size={16} />} value={`${num(r?.commission)}%`} label="Commission rate" />
        <StatCard icon={<Wallet size={16} />} value={eur(commissionCents)} label="Your commission (est.)" />
      </div>

      <section className="mt-6 rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <header className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>By enterprise</h2>
        </header>
        {perEnterprise.length === 0 ? (
          <div className="p-6"><EmptyState compact title="No revenue yet" body="Commission appears as your clients use Relay." /></div>
        ) : (
          <ul>
            {perEnterprise.map((e) => {
              const g = e.usedMinutes * CENTS_PER_MINUTE;
              return (
                <li key={e.id} className="flex items-center justify-between border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                  <span className="truncate text-sm" style={{ color: "var(--text)" }}>{e.name}</span>
                  <span className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {num(e.usedMinutes)}m · {eur(Math.round(g * commissionPct))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </TabBody>
  );
}
