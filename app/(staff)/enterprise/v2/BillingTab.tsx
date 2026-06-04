"use client";

/*
 * Billing & Invoices — pay-per-minute model (no subscription/auto-renew).
 * Plan summary, revenue snapshot, recent transactions (generic labels — no
 * customer PII), CSV statement export.
 *
 * TODO(api): revenue/transactions are synthetic (duration × €3/min) until a
 * real billing/credit ledger is wired. Stripe identifiers are intentionally
 * not exposed to the client.
 */

import { Download, CreditCard } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import { useApiData, eur, LoadingState, ErrorState } from "./_shared";
import { TabTitle, StatCard, CardHeader, BRAND_GREEN, BRAND_GREEN_SOFT } from "./_kit";

type Billing = {
  currency: string;
  revenue: { thisMonthCents: number; last30DaysCents: number; lifetimeCents: number; perMinuteCents: number };
  plan: {
    tier: string; name: string; description: string;
    monthlyPriceCents: number; includedSeats: number; features: string[];
    status: string; currentPeriodEnd: string | null;
  };
  recentTransactions: Array<{
    id: string; occurredAt: string; label: string; durationMin: number; amountCents: number; kind: string;
  }>;
};

export function BillingTab() {
  const { data, loading, error, reload } = useApiData<Billing>("/api/enterprise/billing");

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ErrorState message="No billing data" onRetry={reload} />;

  const tx = data.recentTransactions ?? [];
  const exportStatement = () => {
    const lines = ["Date,Description,Minutes,Amount (EUR)"];
    for (const t of tx) {
      lines.push(`${new Date(t.occurredAt).toISOString().slice(0, 10)},"${t.label}",${t.durationMin},${(t.amountCents / 100).toFixed(2)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "relay-statement.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <TabTitle
        title="Billing & invoices"
        sub={`Pay-per-minute · €${(data.revenue.perMinuteCents / 100).toFixed(2)}/min, billed by the second. No subscription.`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard value={eur(data.revenue.thisMonthCents)} label="Spend this month" accent={BRAND_GREEN} />
        <StatCard value={eur(data.revenue.last30DaysCents)} label="Last 30 days" accent="#0ea5e9" />
        <StatCard value={eur(data.revenue.lifetimeCents)} label="Lifetime" accent="#7c3aed" />
      </div>

      {/* Plan */}
      <section className="mt-4 rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-full" style={{ background: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
              <CreditCard size={18} />
            </span>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{data.plan.name}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{data.plan.description}</div>
            </div>
          </div>
          <StatusBadge compact tone={data.plan.status === "active" ? "ok" : "neutral"}>{data.plan.status}</StatusBadge>
        </div>
        {data.plan.currentPeriodEnd && (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Current period ends {new Date(data.plan.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}
      </section>

      {/* Transactions */}
      <section className="mt-4 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <CardHeader
          title="Recent transactions"
          right={
            <button
              type="button"
              onClick={exportStatement}
              className="inline-flex items-center gap-1.5 text-xs transition-colors hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              <Download size={13} /> Statement
            </button>
          }
        />
        {tx.length === 0 ? (
          <div className="p-6"><EmptyState compact title="No transactions" body="Charges appear here as sessions complete." /></div>
        ) : (
          <ul>
            {tx.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>{t.label}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(t.occurredAt).toLocaleDateString()} · {t.durationMin}m
                  </div>
                </div>
                <span className="text-sm tabular-nums" style={{ color: "var(--text)" }}>{eur(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
