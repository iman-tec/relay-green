"use client";

/*
 * Settings — org profile + a Privacy & Data panel (the enterprise admin is the
 * GDPR controller for their org). Data-subject-rights controls: retention
 * window, export org data (portability), member erasure.
 *
 * TODO(api): retention/export/erasure backends don't exist yet — the controls
 * are wired to clearly-marked stub endpoints. Backend must add:
 *   • PATCH /api/enterprise/settings { retentionDays }
 *   • POST  /api/enterprise/export   → org data bundle (portability)
 *   • POST  /api/enterprise/members/:id/erase → right-to-erasure
 */

import { useState } from "react";
import { Building2, ShieldCheck, Download, Clock, Trash2 } from "lucide-react";
import { Button } from "@/app/_components/ui";
import { useApiData, TabBody, LoadingState, ErrorState } from "./_shared";

type Me = {
  org: { id: string; name: string; status: string; enterpriseCode?: string; primaryDomain?: string | null };
};

const RETENTION_OPTIONS = [
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "12 months" },
  { value: 0, label: "Indefinite" },
];

export function SettingsTab() {
  const { data, loading, error, reload } = useApiData<Me>("/api/enterprise/me");
  const [retention, setRetention] = useState(365);
  const [note, setNote] = useState<string | null>(null);

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const org = data?.org;

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>

      {/* Org profile */}
      <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Organization profile</h2>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Name" value={org?.name ?? "—"} />
          <Row label="Status" value={org?.status ?? "—"} />
          <Row label="Enterprise code" value={org?.enterpriseCode ?? "—"} mono />
          <Row label="Primary domain" value={org?.primaryDomain ?? "—"} />
        </dl>
        <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
          {/* TODO(api): SSO config when present */}
          SSO is configured by Relay support. Contact us to enable SAML/OIDC.
        </p>
      </section>

      {/* Privacy & Data */}
      <section className="mt-6 rounded-2xl border p-5" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)" }}>
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={16} style={{ color: "var(--primary-hover)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Privacy & data</h2>
        </div>

        {/* Retention */}
        <div className="mb-4 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start gap-3">
            <Clock size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} />
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Data retention window</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Session records older than this are purged.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              className="h-10 rounded-lg border px-3 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}
            >
              {RETENTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button size="sm" onClick={() => setNote("TODO(api): retention save not wired yet.")}>Save</Button>
          </div>
        </div>

        {/* Export */}
        <div className="mb-4 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start gap-3">
            <Download size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} />
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Export organization data</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Portable bundle of your org's members + usage.</div>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setNote("TODO(api): org export not wired yet.")}>Request export</Button>
        </div>

        {/* Erasure */}
        <div className="flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start gap-3">
            <Trash2 size={16} className="mt-0.5" style={{ color: "var(--risk)" }} />
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Member erasure requests</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Handle right-to-erasure for a member from the Members tab.</div>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNote("TODO(api): erasure flow not wired yet.")}>Learn more</Button>
        </div>

        {note && <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>{note}</p>}
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
