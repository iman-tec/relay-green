"use client";

/*
 * Clients — the enterprises this Channel Partner manages. ENTERPRISE-LEVEL
 * AGGREGATES ONLY (GDPR): no department breakdown, no member list, no names,
 * no emails, no individual usage. Sourced from /api/reseller/dashboard
 * (org-level only) + a department COUNT from /api/reseller/orgs.
 *
 * If the partner needs to act on a member-level issue, the detail panel
 * surfaces an "ask the enterprise admin" escalation — never direct access.
 */

import { useMemo, useState } from "react";
import { Building2, ShieldCheck, ArrowUpRight } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import {
  useApiData, eur, num, TabBody, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Enterprise = {
  id: string; name: string; enterpriseCode: string; status: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number; createdAt: string;
};
type Dashboard = { reseller: { commission: number }; enterprises: Enterprise[] };
type Org = { id: string; departmentCount: number };

const CENTS_PER_MINUTE = 300;
const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  active: "ok", onboarding: "warn", churned: "neutral", suspended: "neutral",
};

export function ClientsTab() {
  const dash = useApiData<Dashboard>("/api/reseller/dashboard");
  const orgs = useApiData<{ orgs: Org[] }>("/api/reseller/orgs");
  const [selId, setSelId] = useState<string | null>(null);

  const ents = dash.data?.enterprises ?? [];
  const deptCountById = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orgs.data?.orgs ?? []) m.set(o.id, o.departmentCount);
    return m;
  }, [orgs.data]);
  const sel = ents.find((e) => e.id === selId) ?? null;
  const commissionPct = (dash.data?.reseller.commission ?? 0) / 100;

  if (dash.loading) return <TabBody><LoadingState /></TabBody>;
  if (dash.error) return <TabBody><ErrorState message={dash.error} onRetry={dash.reload} /></TabBody>;

  return (
    <TabBody>
      <h1 className="mb-1 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Clients</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Enterprise-level aggregates only — no department or member detail.
      </p>

      {ents.length === 0 ? (
        <EmptyState icon={<Building2 size={20} />} title="No clients yet" body="Enterprises you provision will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* List */}
          <div className="rounded-2xl border lg:col-span-1" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <ul>
              {ents.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelId(e.id)}
                    className="flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: "var(--border)", background: selId === e.id ? "var(--primary-tint)" : undefined }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm" style={{ color: "var(--text)" }}>{e.name}</div>
                      <div className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {num(e.usedMinutes)}/{num(e.allocatedMinutes)}m
                      </div>
                    </div>
                    <StatusBadge compact tone={TONE[e.status] ?? "neutral"}>{e.status}</StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Aggregate detail */}
          <div className="lg:col-span-2">
            {!sel ? (
              <div className="rounded-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <EmptyState compact title="Select a client" body="Pick an enterprise to see its aggregate usage and contract." />
              </div>
            ) : (
              <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-xl font-medium" style={{ color: "var(--text)" }}>{sel.name}</h2>
                    <p className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{sel.enterpriseCode}</p>
                  </div>
                  <StatusBadge tone={TONE[sel.status] ?? "neutral"}>{sel.status}</StatusBadge>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Metric label="Minutes used" value={`${num(sel.usedMinutes)}m`} />
                  <Metric label="Allocated" value={`${num(sel.allocatedMinutes)}m`} />
                  <Metric label="Remaining" value={`${num(sel.remainingMinutes)}m`} />
                  <Metric label="Departments" value={num(deptCountById.get(sel.id) ?? 0)} />
                  <Metric label="Your commission (est.)" value={eur(Math.round(sel.usedMinutes * CENTS_PER_MINUTE * commissionPct))} />
                  <Metric label="Client since" value={new Date(sel.createdAt).toLocaleDateString()} />
                </dl>

                <div className="mt-5 flex items-start gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--primary-tint)" }}>
                  <ShieldCheck size={15} className="mt-0.5" style={{ color: "var(--primary-hover)" }} />
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text)" }}>
                    Department breakdowns, member names, emails and individual usage are
                    not available to Channel Partners. To act on a member-level issue,
                    <a href="mailto:support@relay.green" className="ml-1 inline-flex items-center gap-0.5 underline" style={{ color: "var(--primary-hover)" }}>
                      ask the enterprise admin <ArrowUpRight size={11} />
                    </a>.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </TabBody>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="font-serif text-lg tabular-nums" style={{ color: "var(--text)" }}>{value}</dd>
    </div>
  );
}
