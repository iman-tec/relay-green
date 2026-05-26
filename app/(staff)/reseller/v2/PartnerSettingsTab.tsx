"use client";

/*
 * Channel Partner Settings — partner org profile. Internal-users management +
 * white-label are stubbed (TODO(api)). No client member data.
 */

import { Briefcase, Users } from "lucide-react";
import {
  useApiData, num, TabBody, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Dashboard = {
  reseller: {
    name: string; resellerCode: string; status: string; commission: number;
    totalEnterprises: number;
  };
};

export function PartnerSettingsTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>("/api/reseller/dashboard");
  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const r = data?.reseller;

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>

      <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center gap-2">
          <Briefcase size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Channel Partner profile</h2>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Name" value={r?.name ?? "—"} />
          <Row label="Status" value={r?.status ?? "—"} />
          <Row label="Partner code" value={r?.resellerCode ?? "—"} mono />
          <Row label="Commission" value={`${num(r?.commission)}%`} />
          <Row label="Enterprises" value={num(r?.totalEnterprises)} />
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-2 flex items-center gap-2">
          <Users size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Internal users</h2>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {/* TODO(api): partner internal-user management + optional white-label */}
          Manage your own team members and white-label branding here. Coming soon —
          contact Relay to add internal users to your partner account.
        </p>
      </section>
    </TabBody>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"} style={{ color: "var(--text)" }}>{value}</dd>
    </div>
  );
}
