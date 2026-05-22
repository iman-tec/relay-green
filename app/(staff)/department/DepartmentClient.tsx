"use client";

/*
 * Department admin console.
 *
 *   Header        Dept name + DLC- code + status pill
 *   KPI strip     Allocated / Used / Remaining minutes · #Employees
 *   Employees     Table with create / refill / activate-deactivate.
 *                 No password reset, no reassignment (per spec).
 *
 * Mirrors the visuals of the reseller and enterprise-departments panels
 * so the platform feels consistent across tiers.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Power,
  PowerOff,
  X,
  Search,
  Copy as CopyIcon,
  CheckCircle2,
  Coins,
  Users as UsersIcon,
} from "lucide-react";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";

const BRAND_GREEN = "var(--primary)";
type DepartmentSnapshot = {
  id:                string;
  name:              string;
  departmentCode:    string;
  status:            "active" | "suspended";
  allocatedMinutes:  number;
  usedMinutes:       number;
  remainingMinutes:  number;
};

type EnterpriseSnapshot = {
  id:             string;
  name:           string;
  enterpriseCode: string;
};

type Employee = {
  id:                string;
  displayName:       string;
  email:             string;
  clientType:        string;
  status:            "active" | "suspended";
  allocatedMinutes:  number;
  usedMinutes:       number;
  remainingMinutes:  number;
  createdAt:         string;
};

export function DepartmentClient() {
  const [dept, setDept] = useState<DepartmentSnapshot | null>(null);
  const [enterprise, setEnterprise] = useState<EnterpriseSnapshot | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 3000);
    return () => clearTimeout(t);
  }, [info]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/department/employees", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        department?:  DepartmentSnapshot;
        enterprise?:  EnterpriseSnapshot;
        employees?:   Employee[];
        error?:       string;
      };
      if (!res.ok || !body.department) {
        setError(body.error ?? "Couldn't load department.");
        return;
      }
      setDept(body.department);
      setEnterprise(body.enterprise ?? null);
      setEmployees(body.employees ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load department.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }
  if (error || !dept) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <p className="text-sm" style={{ color: "var(--accent-red)" }}>
          {error ?? "Couldn't load the department console."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      {info && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium"
          style={{
            backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
            color: BRAND_GREEN,
            borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
            animation: "relay-toast-in 180ms ease-out",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} />
            {info}
          </span>
          <button type="button" onClick={() => setInfo(null)} className="rounded-md p-1">
            <X size={14} />
          </button>
        </div>
      )}

      <Header dept={dept} enterprise={enterprise} />
      <KpiStrip dept={dept} count={employees.length} />
      <EmployeesSection
        dept={dept}
        employees={employees}
        onMutated={async () => { await load(); }}
        onInfo={(m) => setInfo(m)}
        onError={(m) => setError(m)}
      />
    </div>
  );
}

/* ──────── Header ──────── */

function Header({ dept, enterprise }: { dept: DepartmentSnapshot; enterprise: EnterpriseSnapshot | null }) {
  return (
    <header className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
          {dept.name}
        </h1>
        <div
          className="mt-1 inline-flex items-center gap-2 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{dept.departmentCode}</span>
          <CopyButton text={dept.departmentCode} />
          <StatusChip status={dept.status} />
          {enterprise && (
            <span className="ml-2">
              · <span style={{ color: "var(--text)" }}>{enterprise.name}</span>
              {" "}
              <span style={{ fontFamily: "var(--font-mono)" }}>{enterprise.enterpriseCode}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/* ──────── KPI strip ──────── */

function KpiStrip({ dept, count }: { dept: DepartmentSnapshot; count: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-px rounded-xl border md:grid-cols-4"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--border)",
      }}
    >
      <Kpi label="Allocated minutes"  value={fmt(dept.allocatedMinutes)} />
      <Kpi label="Used minutes"       value={fmt(dept.usedMinutes)} />
      <Kpi label="Remaining minutes"  value={fmt(dept.remainingMinutes)} accent />
      <Kpi label="Employees"          value={String(count)} />
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="flex flex-col gap-1 px-5 py-4"
      style={{ backgroundColor: "var(--surface)" }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="text-lg font-semibold"
        style={{ color: accent ? BRAND_GREEN : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ──────── Employees section ──────── */

function EmployeesSection({
  dept, employees, onMutated, onInfo, onError,
}: {
  dept: DepartmentSnapshot;
  employees: Employee[];
  onMutated: () => Promise<void>;
  onInfo:  (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [refillTarget, setRefillTarget] = useState<Employee | null>(null);
  const [query, setQuery] = useState("");
  const confirmDialog = useConfirmDialog();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      e.displayName.toLowerCase().includes(q)
      || e.email.toLowerCase().includes(q),
    );
  }, [employees, query]);

  const create = async (input: { name: string; email: string; allocatedMinutes: number }) => {
    const res = await fetch("/api/department/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; employee?: { email: string } };
    if (!res.ok) return { ok: false as const, error: body.error ?? "Couldn't add employee." };
    onInfo(`Invitation sent to ${body.employee?.email ?? input.email}.`);
    await onMutated();
    return { ok: true as const };
  };

  const toggleStatus = async (e: Employee) => {
    const next = e.status === "active" ? "suspended" : "active";
    if (next === "suspended") {
      const ok = await confirmDialog.ask({
        title: `Deactivate ${e.displayName || e.email}?`,
        message: "Their login will be disabled and any remaining minutes will be returned to the department pool.",
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/department/employees/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { onError(body.error ?? "Update failed."); return; }
    onInfo(next === "active" ? `Reactivated ${e.displayName || e.email}.` : `Deactivated ${e.displayName || e.email}.`);
    await onMutated();
  };

  const refill = async (e: Employee, amount: number) => {
    const res = await fetch(`/api/department/employees/${e.id}/refill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false as const, error: body.error ?? "Refill failed." };
    onInfo(`Added ${amount} minutes to ${e.displayName || e.email}.`);
    await onMutated();
    return { ok: true as const };
  };

  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="inline-flex items-center gap-2">
          <UsersIcon size={14} style={{ color: BRAND_GREEN }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Employees ({employees.length})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {employees.length > 0 && (
            <div className="relative" style={{ width: 220 }}>
              <Search
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                placeholder="Search…"
                className="w-full rounded-md border py-1.5 pl-7 pr-7 text-xs outline-none"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--background)",
                  color: "var(--text)",
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5"
                  style={{ color: "var(--text-muted)" }}
                  title="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setCreating(true)}
            disabled={dept.status !== "active"}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
            title={dept.status === "active" ? "Add an employee" : "Department is not active"}
          >
            <Plus size={11} />
            Add employee
          </button>
        </div>
      </div>

      {employees.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No employees yet. Click <span style={{ color: "var(--text)" }}>Add employee</span> to invite someone.
        </p>
      ) : (
        <ul>
          {filtered.map((e) => (
            <EmployeeRow
              key={e.id}
              emp={e}
              onRefill={() => setRefillTarget(e)}
              onToggleStatus={() => void toggleStatus(e)}
            />
          ))}
          {filtered.length === 0 && (
            <li className="px-5 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No employees match “{query}”.
            </li>
          )}
        </ul>
      )}

      {creating && (
        <EmployeeCreateModal
          deptRemaining={dept.remainingMinutes}
          cancel={() => setCreating(false)}
          submit={async (input) => {
            const r = await create(input);
            if (r.ok) setCreating(false);
            return r;
          }}
        />
      )}

      {refillTarget && (
        <RefillModal
          employee={refillTarget}
          deptRemaining={dept.remainingMinutes}
          cancel={() => setRefillTarget(null)}
          submit={async (amount) => {
            const r = await refill(refillTarget, amount);
            if (r.ok) setRefillTarget(null);
            return r;
          }}
        />
      )}
      {confirmDialog.element}
    </section>
  );
}

function EmployeeRow({
  emp, onRefill, onToggleStatus,
}: {
  emp: Employee;
  onRefill: () => void;
  onToggleStatus: () => void;
}) {
  const isActive = emp.status === "active";
  return (
    <li
      className="grid items-center gap-3 border-t px-5 py-3"
      style={{
        borderColor: "var(--border)",
        gridTemplateColumns: "1.6fr 0.9fr 0.9fr 0.9fr 0.9fr auto",
      }}
    >
      <div className="min-w-0">
        <div className="truncate text-sm" style={{ color: "var(--text)" }}>{emp.displayName || emp.email}</div>
        {emp.displayName && emp.email && (
          <div
            className="mt-0.5 truncate text-[11px]"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
          >
            {emp.email}
          </div>
        )}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        <StatusChip status={emp.status} />
      </div>
      <MetricCell label="Allocated" value={fmt(emp.allocatedMinutes)} />
      <MetricCell label="Used"      value={fmt(emp.usedMinutes)} />
      <MetricCell label="Remaining" value={fmt(emp.remainingMinutes)} accent />
      <div className="inline-flex items-center gap-1 justify-self-end">
        <button
          onClick={onRefill}
          disabled={!isActive}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
          title="Add minutes"
        >
          <Coins size={11} />
          Refill
        </button>
        <button
          onClick={onToggleStatus}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
          style={{
            borderColor: "var(--border)",
            color: isActive ? "var(--accent-red)" : BRAND_GREEN,
          }}
          title={isActive ? "Deactivate employee" : "Reactivate employee"}
        >
          {isActive ? <Power size={11} /> : <PowerOff size={11} />}
          {isActive ? "Deactivate" : "Reactivate"}
        </button>
      </div>
    </li>
  );
}

function MetricCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="text-sm font-medium tabular-nums"
        style={{ color: accent ? BRAND_GREEN : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ──────── Modals ──────── */

function EmployeeCreateModal({
  deptRemaining, cancel, submit,
}: {
  deptRemaining: number;
  cancel: () => void;
  submit: (input: { name: string; email: string; allocatedMinutes: number }) =>
    Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [allocatedMinutes, setAllocatedMinutes] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!name.trim() || !email.trim()) { setErr("Name and email are required."); return; }
    const alloc = Number(allocatedMinutes);
    if (Number.isNaN(alloc) || alloc < 0) { setErr("Allocation must be ≥ 0."); return; }
    if (alloc > deptRemaining) { setErr(`Allocation exceeds department remaining (${deptRemaining}).`); return; }
    setBusy(true); setErr(null);
    const r = await submit({ name: name.trim(), email: email.trim(), allocatedMinutes: alloc });
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <ModalShell title="Add employee" onClose={busy ? () => undefined : cancel}>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Department pool remaining: <strong>{fmt(deptRemaining)}</strong> minutes.
      </p>
      <div className="grid gap-2">
        <Field label="Employee name" value={name} onChange={setName} placeholder="Jane Doe" autoFocus />
        <Field label="Employee email" value={email} onChange={setEmail} placeholder="jane@acme.com" type="email" />
        <Field label="Initial minutes" value={allocatedMinutes} onChange={setAllocatedMinutes} type="number" />
      </div>
      {err && <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={cancel} disabled={busy} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </div>
    </ModalShell>
  );
}

function RefillModal({
  employee, deptRemaining, cancel, submit,
}: {
  employee: Employee;
  deptRemaining: number;
  cancel: () => void;
  submit: (amount: number) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [amount, setAmount] = useState("60");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setErr("Amount must be > 0."); return; }
    if (n > deptRemaining) { setErr(`Exceeds department remaining (${deptRemaining}).`); return; }
    setBusy(true); setErr(null);
    const r = await submit(n);
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <ModalShell title={`Refill — ${employee.displayName || employee.email}`} onClose={busy ? () => undefined : cancel}>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Department remaining: <strong>{fmt(deptRemaining)}</strong> minutes.
      </p>
      <Field label="Minutes to add" value={amount} onChange={setAmount} type="number" autoFocus />
      {err && <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={cancel} disabled={busy} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Coins size={11} />}
          {busy ? "Adding…" : "Add minutes"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.40)" }}>
      <div
        className="w-full max-w-md rounded-xl border p-4"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h4>
          <button onClick={onClose} className="rounded-md p-1" style={{ color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ──────── Small bits ──────── */

function Field({
  label, value, onChange, placeholder, type = "text", autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="rounded-md border px-2.5 py-1.5 text-sm outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--background)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}

function StatusChip({ status }: { status: "active" | "suspended" }) {
  if (status === "suspended") {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        Suspended
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      Active
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard refused */ }
      }}
      className="rounded-md p-0.5 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
      style={{ color: copied ? BRAND_GREEN : "var(--text-muted)" }}
    >
      {copied ? <CheckCircle2 size={11} /> : <CopyIcon size={11} />}
    </button>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined).format(Math.round(n));
}
