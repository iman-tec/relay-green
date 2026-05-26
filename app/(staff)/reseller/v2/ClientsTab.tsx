"use client";

/*
 * Clients — the companies this Channel Partner has onboarded. The partner
 * sees WHO they onboarded and HOW MUCH each company is spending (money), plus
 * their own commission. They do NOT see allocation (minute pools), departments
 * or members — a company manages its own people internally.
 *
 * Onboarding: the partner provisions a company by naming the individual who
 * becomes its enterprise admin (invited by email). That person then builds out
 * departments + members.
 */

import { useMemo, useState } from "react";
import { Building2, UserPlus, Mail } from "lucide-react";
import { Button, Input, Modal, StatusBadge, EmptyState } from "@/app/_components/ui";
import {
  useApiData, eur, num, TabBody, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Enterprise = {
  id: string; name: string; enterpriseCode: string; status: string;
  usedMinutes: number; createdAt: string;
};
type Dashboard = { reseller: { commission: number }; enterprises: Enterprise[] };

const CENTS_PER_MINUTE = 300;
const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  active: "ok", onboarding: "warn", churned: "neutral", suspended: "neutral",
};

export function ClientsTab() {
  const dash = useApiData<Dashboard>("/api/reseller/dashboard");
  const [selId, setSelId] = useState<string | null>(null);

  const ents = dash.data?.enterprises ?? [];
  const commissionPct = (dash.data?.reseller.commission ?? 0) / 100;
  const sel = ents.find((e) => e.id === selId) ?? null;
  const spend = (e: Enterprise) => e.usedMinutes * CENTS_PER_MINUTE;

  // Onboarding
  const [open, setOpen] = useState(false);
  const [co, setCo] = useState(""); const [adminName, setAdminName] = useState(""); const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const onboard = async () => {
    if (!co.trim() || !adminName.trim() || !adminEmail.trim()) { setErr("Company name, admin name and email are required."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/reseller/enterprises", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: co.trim(), adminDisplayName: adminName.trim(), adminEmail: adminEmail.trim().toLowerCase(), allocatedMinutes: 0 }),
      });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(b.error || "Could not onboard company");
      setOpen(false); setCo(""); setAdminName(""); setAdminEmail(""); dash.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not onboard company"); }
    finally { setBusy(false); }
  };

  const totalSpend = useMemo(() => ents.reduce((s, e) => s + spend(e), 0), [ents]);

  if (dash.loading) return <TabBody><LoadingState /></TabBody>;
  if (dash.error) return <TabBody><ErrorState message={dash.error} onRetry={dash.reload} /></TabBody>;

  return (
    <TabBody>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Clients</h1>
        <Button iconLeft={<UserPlus size={15} />} onClick={() => setOpen(true)}>Onboard a company</Button>
      </div>

      {ents.length === 0 ? (
        <EmptyState icon={<Building2 size={20} />} title="No companies yet"
          body="Onboard your first company — name the person who'll run their Relay account."
          action={<Button onClick={() => setOpen(true)}>Onboard a company</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* List */}
          <div className="rounded-2xl border lg:col-span-1" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <ul>
              {ents.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setSelId(e.id)}
                    className="flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: "var(--border)", background: selId === e.id ? "var(--primary-tint)" : undefined }}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm" style={{ color: "var(--text)" }}>{e.name}</div>
                      <div className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{eur(spend(e))} spent</div>
                    </div>
                    <StatusBadge compact tone={TONE[e.status] ?? "neutral"}>{e.status}</StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Detail — spend + commission, no allocation/departments/members */}
          <div className="lg:col-span-2">
            {!sel ? (
              <div className="rounded-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <EmptyState compact title="Select a company" body="See spend, commission and account status." />
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
                  <Metric label="Spend to date" value={eur(spend(sel))} />
                  <Metric label="Your commission" value={eur(Math.round(spend(sel) * commissionPct))} />
                  <Metric label="Client since" value={new Date(sel.createdAt).toLocaleDateString()} />
                </dl>
                <p className="mt-5 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
                  This company manages its own departments and people. You see spend and
                  commission — not their internal teams or member details.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {ents.length > 0 && (
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Portfolio spend to date: <strong style={{ color: "var(--text)" }}>{eur(totalSpend)}</strong> across {num(ents.length)} companies.
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Onboard a company"
        description="Name the person who'll run this company's Relay account — they'll be invited as the enterprise admin and set up their own departments and team."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button onClick={onboard} loading={busy} iconLeft={<Mail size={14} />}>Send invite</Button></div>}>
        <div className="flex flex-col gap-3">
          <Input label="Company name" value={co} onChange={(e) => setCo(e.target.value)} placeholder="Acme Inc." />
          <Input label="Admin full name" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Jordan Reed" />
          <Input label="Admin email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="jordan@acme.com" />
          {err && <p className="text-xs" style={{ color: "var(--risk)" }}>{err}</p>}
        </div>
      </Modal>
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
