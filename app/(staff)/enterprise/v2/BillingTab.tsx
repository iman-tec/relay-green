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

import { Download, Receipt, CreditCard } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import {
  useApiData, eur, TabBody, StatCard, LoadingState, ErrorState,
} from "./_shared";

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

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  if (!data) return <TabBody><ErrorState message="No billing data" onRetry={reload} /></TabBody>;

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
    <TabBody>
      <h1 className="mb-1 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Billing & invoices</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Pay-per-minute · €{(data.revenue.perMinuteCents / 100).toFixed(2)}/min, billed by the second. No subscription.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard icon={<Receipt size={16} />} value={eur(data.revenue.thisMonthCents)} label="Spend this month" />
        <StatCard icon={<Receipt size={16} />} value={eur(data.revenue.last30DaysCents)} label="Last 30 days" />
        <StatCard icon={<Receipt size={16} />} value={eur(data.revenue.lifetimeCents)} label="Lifetime" />
      </div>

      {/* Plan */}
      <section className="mt-6 rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl" style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}>
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
      <section className="mt-6 rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Recent transactions</h2>
          <button
            type="button"
            onClick={exportStatement}
            className="inline-flex items-center gap-1.5 text-xs transition-colors hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            <Download size={13} /> Statement
          </button>
        </header>
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
    </TabBody>
  );
}
