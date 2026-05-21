"use client";

/*
 * Enterprise tab — 2-sidebar drill-down for the reseller panel.
 *
 *   Sidebar 1: enterprises owned by the calling reseller
 *   Sidebar 2: departments of the selected enterprise
 *   Main:      department detail card + dept-admin card + employees table
 *
 * The reseller is read-only on departments + employees (those are
 * managed by enterprise/department admins). On enterprises, the reseller
 * can create new ones, refill minutes, and toggle status — the same
 * mutations the legacy /reseller console exposes; we're just moving them
 * into the redesigned drill-down shell.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Coins, Power, PowerOff, Pencil } from "lucide-react";
import { Sidebar } from "@/app/_components/admin-v2/Sidebar";
import { MinutesBar } from "@/app/_components/admin-v2/MinutesBar";
import { DetailCard, type Badge } from "@/app/_components/admin-v2/DetailCard";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { EditNameDrawer } from "@/app/_components/admin-v2/EditNameDrawer";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";
import { AddEnterpriseDrawer } from "./_drawers/AddEnterpriseDrawer";
import { AddDepartmentDrawer } from "./_drawers/AddDepartmentDrawer";
import { RefillDrawer } from "./_drawers/RefillDrawer";

type ResellerSnapshot = {
  id: string; name: string; resellerCode: string; status: string; commission: number;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
};
type Department = {
  id: string; name: string; departmentCode: string;
  adminUserId: string | null;
  status: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  memberCount: number;
};
type Enterprise = {
  id: string; name: string;
  enterpriseCode: string;
  primaryDomain: string | null;
  status: string;
  enterpriseType: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  departments: Department[];
};
type Employee = {
  id: string; displayName: string; email: string;
  primaryRole: string | null; clientType: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  status: string; lastSignIn: string | null;
};

export function EnterpriseTab() {
  const [reseller, setReseller] = useState<ResellerSnapshot | null>(null);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [selectedEntId,  setEntId]  = useState<string | null>(null);
  const [selectedDeptId, setDeptId] = useState<string | null>(null);

  const [addEnt,        setAddEnt]        = useState(false);
  const [addDept,       setAddDept]       = useState(false);
  const [refillTarget,  setRefillTarget]  = useState<Enterprise | null>(null);
  const [editEnt,       setEditEnt]       = useState(false);
  const [editDept,      setEditDept]      = useState(false);

  const [employees, setEmployees]       = useState<Employee[]>([]);
  const [deptAdmin, setDeptAdmin]       = useState<Employee | null>(null);
  const [empLoading, setEmpLoading]     = useState(false);
  const [empError,   setEmpError]       = useState<string | null>(null);

  const confirm = useConfirmDialog();

  // ─ Load reseller + enterprises (with departments) ──────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/reseller/orgs", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        reseller?: ResellerSnapshot; orgs?: Enterprise[]; error?: string;
      };
      if (!res.ok || !body.reseller || !body.orgs) {
        setError(body.error ?? "Couldn't load enterprises.");
        return;
      }
      setReseller(body.reseller);
      setEnterprises(body.orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load enterprises.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const selectedEnt: Enterprise | null =
    enterprises.find((e) => e.id === selectedEntId) ?? null;
  const selectedDept: Department | null =
    selectedEnt?.departments.find((d) => d.id === selectedDeptId) ?? null;

  // Reset the dept selection when the enterprise changes.
  useEffect(() => {
    setDeptId(null);
    setEmployees([]);
    setEmpError(null);
  }, [selectedEntId]);

  // Fetch employees whenever the selected dept changes.
  useEffect(() => {
    if (!selectedEntId || !selectedDeptId) {
      setEmployees([]);
      setDeptAdmin(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setEmpLoading(true);
      setEmpError(null);
      try {
        const res  = await fetch(
          `/api/reseller/orgs/${selectedEntId}/departments/${selectedDeptId}/employees`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as {
          employees?: Employee[]; admin?: Employee | null; error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.employees) {
          setEmpError(body.error ?? "Couldn't load employees.");
          return;
        }
        setEmployees(body.employees);
        setDeptAdmin(body.admin ?? null);
      } catch (e) {
        if (!cancelled) setEmpError(e instanceof Error ? e.message : "Couldn't load employees.");
      } finally {
        if (!cancelled) setEmpLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEntId, selectedDeptId]);

  // ─ Derived rollups ─────────────────────────────────────────────────
  const entSummaries = useMemo(() => {
    const map = new Map<string, {
      pool:        { used: number; allocated: number };
      distributed: { used: number; allocated: number };
      deptCount:   number;
    }>();
    for (const e of enterprises) {
      let dUsed = 0, dAllocated = 0;
      for (const d of e.departments) {
        dUsed      += d.usedMinutes;
        dAllocated += d.allocatedMinutes;
      }
      map.set(e.id, {
        pool:        { used: e.usedMinutes,  allocated: e.allocatedMinutes },
        distributed: { used: dUsed,          allocated: dAllocated },
        deptCount:   e.departments.length,
      });
    }
    return map;
  }, [enterprises]);

  const employeeTotals = useMemo(() => {
    let used = 0, allocated = 0;
    for (const emp of employees) {
      used      += emp.usedMinutes;
      allocated += emp.allocatedMinutes;
    }
    return { used, allocated };
  }, [employees]);

  // ─ Mutations (reseller scope only) ─────────────────────────────────
  const toggleEntStatus = async (ent: Enterprise) => {
    const next = ent.status === "active" ? "suspended" : "active";
    if (next === "suspended") {
      const ok = await confirm.ask({
        title:        `Deactivate "${ent.name}"?`,
        message:      "Login will be disabled and the enterprise frozen. Balances are NOT refunded upward.",
        confirmLabel: "Deactivate",
        tone:         "danger",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/reseller/enterprises/${ent.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      alert(b.error ?? "Update failed.");
      return;
    }
    refresh();
  };

  // ─ Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }
  if (error || !reseller) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-sm" style={{ color: "var(--primary)" }}>
          {error ?? "Couldn't load the reseller console."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar 1 — enterprises */}
      <Sidebar
        title="Enterprises"
        searchPlaceholder="Search enterprises…"
        items={enterprises.map((e) => ({
          id:     e.id,
          label:  e.name,
          search: `${e.name} ${e.enterpriseCode} ${e.primaryDomain ?? ""}`,
          _data:  e,
        }))}
        selectedId={selectedEntId}
        onSelect={(it) => {
          setDeptId(null);
          setEmployees([]);
          setDeptAdmin(null);
          setEmpError(null);
          setEntId(it.id);
        }}
        emptyMessage={loading ? "Loading…" : "No enterprises yet."}
        footer={
          <button
            type="button"
            onClick={() => setAddEnt(true)}
            disabled={reseller.status !== "active"}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--primary)", color: "#fff" }}
            title={reseller.status === "active" ? "Onboard a new enterprise" : "Reseller is not active"}
          >
            <Plus className="size-3.5" /> Add Enterprise
          </button>
        }
        renderRow={(it) => {
          const e = (it as unknown as { _data: Enterprise })._data;
          const r = entSummaries.get(e.id)?.pool ?? { used: 0, allocated: 0 };
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {e.name}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: e.status === "active" ? "#3dcb7e" : "var(--text-muted)" }}
                />
              </div>
              <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                {e.departments.length} dept{e.departments.length === 1 ? "" : "s"}
                {e.primaryDomain ? ` · ${e.primaryDomain}` : ""}
              </div>
              <MinutesBar used={r.used} allocated={r.allocated} size="sm" />
            </div>
          );
        }}
      />

      {/* Sidebar 2 — departments */}
      <Sidebar
        title="Departments"
        searchPlaceholder="Search departments…"
        width={260}
        items={(selectedEnt?.departments ?? []).map((d) => ({
          id:     d.id,
          label:  d.name,
          search: `${d.name} ${d.departmentCode}`,
          _data:  d,
        }))}
        selectedId={selectedDeptId}
        onSelect={(it) => setDeptId(it.id)}
        emptyMessage={selectedEnt ? "No departments yet." : "Select an enterprise."}
        footer={
          selectedEnt && (
            <button
              type="button"
              onClick={() => setAddDept(true)}
              disabled={selectedEnt.status !== "active"}
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--primary)", color: "#fff" }}
              title={selectedEnt.status === "active" ? "Create a new department" : "Enterprise is not active"}
            >
              <Plus className="size-3.5" /> Add Department
            </button>
          )
        }
        renderRow={(it) => {
          const d = (it as unknown as { _data: Department })._data;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {d.name}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: d.status === "active" ? "#3dcb7e" : "var(--text-muted)" }}
                />
              </div>
              <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                {d.memberCount} member{d.memberCount === 1 ? "" : "s"}
              </div>
              <MinutesBar used={d.usedMinutes} allocated={d.allocatedMinutes} size="sm" />
            </div>
          );
        }}
      />

      {/* Main area */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={(() => {
            const crumbs: Crumb[] = [{
              label:   reseller.name,
              onClick: () => {
                setDeptId(null);
                setEmployees([]);
                setDeptAdmin(null);
                setEntId(null);
              },
            }];
            if (selectedEnt) {
              crumbs.push({
                label:   selectedEnt.name,
                onClick: () => {
                  setDeptId(null);
                  setEmployees([]);
                  setDeptAdmin(null);
                },
              });
            }
            if (selectedDept) {
              crumbs.push({ label: selectedDept.name });
            }
            return crumbs;
          })()}
        />

        {!selectedEnt && (
          <ResellerOverview reseller={reseller} enterprises={enterprises} />
        )}

        {selectedEnt && !selectedDept && (
          <EnterpriseSummary
            ent={selectedEnt}
            summary={entSummaries.get(selectedEnt.id)}
            onEdit={() => setEditEnt(true)}
            onRefill={() => setRefillTarget(selectedEnt)}
            onToggle={() => toggleEntStatus(selectedEnt)}
          />
        )}

        {selectedEnt && selectedDept && (
          <div className="flex flex-col gap-6">
            <DetailCard
              title={selectedDept.name}
              code={selectedDept.departmentCode}
              badges={[
                {
                  label: selectedDept.status === "active" ? "Active" : "Suspended",
                  tone:  selectedDept.status === "active" ? "success" : "warning",
                },
              ]}
              minutes={{
                used:      selectedDept.usedMinutes,
                allocated: selectedDept.allocatedMinutes,
              }}
              rollupCaption={(() => {
                if (employees.length === 0) {
                  return `${selectedDept.allocatedMinutes.toLocaleString()} min in pool · 0 employees yet · ${selectedDept.usedMinutes.toLocaleString()} used`;
                }
                const remaining = Math.max(0, selectedDept.allocatedMinutes - employeeTotals.allocated);
                return (
                  `${selectedDept.allocatedMinutes.toLocaleString()} allocated · ` +
                  `${employeeTotals.allocated.toLocaleString()} distributed to ${employees.length} employee${employees.length === 1 ? "" : "s"} · ` +
                  `${remaining.toLocaleString()} remaining · ` +
                  `${selectedDept.usedMinutes.toLocaleString()} used`
                );
              })()}
              actions={
                <button
                  type="button"
                  onClick={() => setEditDept(true)}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  <Pencil className="size-3" /> Edit
                </button>
              }
            />
            <DepartmentAdminCard admin={deptAdmin} />
            <EmployeeTable
              loading={empLoading}
              error={empError}
              employees={employees}
              totals={employeeTotals}
            />
          </div>
        )}
      </main>

      <AddEnterpriseDrawer
        open={addEnt}
        resellerRemaining={reseller.remainingMinutes}
        onClose={() => setAddEnt(false)}
        onCreated={(orgId) => {
          setAddEnt(false);
          refresh().then(() => setEntId(orgId));
        }}
      />

      <AddDepartmentDrawer
        open={addDept}
        orgId={selectedEntId}
        orgRemainingMinutes={selectedEnt?.remainingMinutes}
        onClose={() => setAddDept(false)}
        onCreated={(deptId) => {
          setAddDept(false);
          refresh().then(() => setDeptId(deptId));
        }}
      />

      <RefillDrawer
        target={refillTarget}
        resellerRemaining={reseller.remainingMinutes}
        onClose={() => setRefillTarget(null)}
        onRefilled={() => {
          setRefillTarget(null);
          refresh();
        }}
      />
      {selectedEnt && (
        <EditNameDrawer
          open={editEnt}
          title="Edit enterprise"
          label="Enterprise name"
          currentName={selectedEnt.name}
          endpoint={`/api/reseller/enterprises/${selectedEnt.id}`}
          onClose={() => setEditEnt(false)}
          onSaved={() => { setEditEnt(false); refresh(); }}
        />
      )}
      {selectedEnt && selectedDept && (
        <EditNameDrawer
          open={editDept}
          title="Edit department"
          label="Department name"
          currentName={selectedDept.name}
          endpoint={`/api/reseller/orgs/${selectedEnt.id}/departments/${selectedDept.id}`}
          onClose={() => setEditDept(false)}
          onSaved={() => { setEditDept(false); refresh(); }}
        />
      )}

      {confirm.element}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function ResellerOverview({
  reseller, enterprises,
}: { reseller: ResellerSnapshot; enterprises: Enterprise[] }) {
  const total       = enterprises.length;
  const distributed = enterprises.reduce((s, e) => s + e.allocatedMinutes, 0);
  const remaining   = Math.max(0, reseller.allocatedMinutes - distributed);

  return (
    <div className="flex flex-col gap-6">
      <DetailCard
        title={reseller.name}
        code={reseller.resellerCode}
        badges={[
          {
            label: reseller.status === "active" ? "Active" : "Suspended",
            tone:  reseller.status === "active" ? "success" : "warning",
          },
          { label: `${reseller.commission}% commission`, tone: "neutral" },
        ]}
        description="Pick an enterprise on the left to view its departments and employees."
        minutes={{ used: reseller.usedMinutes, allocated: reseller.allocatedMinutes }}
        rollupCaption={
          total === 0
            ? `${reseller.allocatedMinutes.toLocaleString()} min in pool · 0 enterprises yet · ${reseller.usedMinutes.toLocaleString()} used`
            : `${reseller.allocatedMinutes.toLocaleString()} allocated · ` +
              `${distributed.toLocaleString()} distributed to ${total} enterprise${total === 1 ? "" : "s"} · ` +
              `${remaining.toLocaleString()} remaining · ` +
              `${reseller.usedMinutes.toLocaleString()} used`
        }
      />
    </div>
  );
}

function EnterpriseSummary({
  ent, summary, onEdit, onRefill, onToggle,
}: {
  ent: Enterprise;
  summary?: {
    pool:        { used: number; allocated: number };
    distributed: { used: number; allocated: number };
    deptCount:   number;
  };
  onEdit:   () => void;
  onRefill: () => void;
  onToggle: () => void;
}) {
  const badges: Badge[] = [
    {
      label: ent.status === "active" ? "Active" : "Suspended",
      tone:  ent.status === "active" ? "success" : "warning",
    },
  ];

  const pool        = summary?.pool        ?? { used: ent.usedMinutes, allocated: ent.allocatedMinutes };
  const distributed = summary?.distributed ?? { used: 0, allocated: 0 };
  const deptCount   = summary?.deptCount   ?? ent.departments.length;
  const remaining   = Math.max(0, pool.allocated - distributed.allocated);

  const caption =
    deptCount === 0
      ? `${pool.allocated.toLocaleString()} min in pool · 0 departments yet · ${pool.used.toLocaleString()} used`
      : `${pool.allocated.toLocaleString()} allocated · ` +
        `${distributed.allocated.toLocaleString()} distributed to ${deptCount} department${deptCount === 1 ? "" : "s"} · ` +
        `${remaining.toLocaleString()} remaining · ` +
        `${pool.used.toLocaleString()} used`;

  return (
    <DetailCard
      title={ent.name}
      code={ent.enterpriseCode}
      badges={badges}
      description={ent.primaryDomain ? `Domain: ${ent.primaryDomain}` : undefined}
      minutes={pool}
      rollupCaption={caption}
      actions={
        <>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <Pencil className="size-3" /> Edit
          </button>
          <button
            type="button"
            onClick={onRefill}
            disabled={ent.status !== "active"}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: "var(--primary)" }}
            title="Add minutes from your pool"
          >
            <Coins className="size-3.5" /> Refill
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {ent.status === "active"
              ? <><Power className="size-3.5" /> Deactivate</>
              : <><PowerOff className="size-3.5" /> Reactivate</>}
          </button>
        </>
      }
    />
  );
}

function DepartmentAdminCard({ admin }: { admin: Employee | null }) {
  return (
    <section
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Department admin
        </span>
      </header>
      {!admin ? (
        <p className="px-4 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No admin assigned yet. The enterprise admin appoints one from their console.
        </p>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{
              background: "color-mix(in srgb, var(--primary) 16%, transparent)",
              color:      "var(--primary)",
            }}
          >
            {initialsFor(admin)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
              {admin.displayName || "—"}
            </div>
            <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {admin.email}
            </div>
          </div>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{
              color:      "var(--primary)",
              background: "color-mix(in srgb, var(--primary) 14%, transparent)",
            }}
          >
            {admin.primaryRole === "department_admin"
              ? "Dept admin"
              : (admin.primaryRole ?? "admin").replace(/_/g, " ")}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{
              color: admin.status === "active" ? "#3dcb7e" : "var(--text-muted)",
              background: admin.status === "active"
                ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
            }}
          >
            {admin.status}
          </span>
        </div>
      )}
    </section>
  );
}

function initialsFor(e: Employee): string {
  const src = e.displayName || e.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

function EmployeeTable({
  loading, error, employees, totals,
}: {
  loading: boolean;
  error: string | null;
  employees: Employee[];
  totals: { used: number; allocated: number };
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Employees ({employees.length})
        </span>
      </header>
      {loading && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      )}
      {!loading && error && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--primary)" }}>
          {error}
        </p>
      )}
      {!loading && !error && employees.length === 0 && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No employees in this department.
        </p>
      )}
      {!loading && !error && employees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-[11px] tracking-wider uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Minutes (used / allocated)</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr
                  key={e.id}
                  className="border-t"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                    {e.displayName || "—"}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {e.email}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                    {e.usedMinutes.toLocaleString()} / {e.allocatedMinutes.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                      style={{
                        color: e.status === "active" ? "#3dcb7e" : "var(--text-muted)",
                        background: e.status === "active"
                          ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                          : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                      }}
                    >
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                <td colSpan={2} className="px-4 py-2.5 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                  Total
                </td>
                <td className="px-4 py-2.5 text-sm font-medium" style={{ color: "var(--text)" }}>
                  {totals.used.toLocaleString()} / {totals.allocated.toLocaleString()}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
