"use client";

/*
 * Department admin Employees tab — no sidebar (dept admins manage one
 * department), just a dept summary card at the top and the employees
 * table below.
 *
 * Patterns mirror the other v2 panels:
 *   • Mutually-exclusive views aren't needed (single level)
 *   • Per-row icons: Refill / Deactivate / Reactivate
 *   • Per-spec the dept admin cannot reassign or hard-delete employees,
 *     so no Remove icon — `Deactivate` returns the employee's remaining
 *     minutes to the dept pool via the deactivate_employee RPC.
 *   • Parent (dept) minutes = its own pool, caption shows distribution
 *     across employees.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Power, PowerOff, Coins, Pencil, Upload } from "lucide-react";
import { DetailCard } from "@/app/_components/admin-v2/DetailCard";
import { EditNameDrawer } from "@/app/_components/admin-v2/EditNameDrawer";
import { Button } from "@/app/_components/ui";
import { InviteFlow } from "@/app/_components/invite/InviteFlow";
import { InviteStatusTable } from "@/app/_components/invite/InviteStatusTable";
import { AddEmployeeDrawer } from "./_drawers/AddEmployeeDrawer";
import { RefillEmployeeDrawer } from "./_drawers/RefillEmployeeDrawer";

type Department = {
  id:               string;
  name:             string;
  departmentCode:   string;
  status:           string;
  allocatedMinutes: number;
  usedMinutes:      number;
  remainingMinutes: number;
};
type EnterpriseLite = {
  id:             string;
  name:           string;
  enterpriseCode: string;
};
type Employee = {
  id:               string;
  displayName:      string;
  email:            string;
  clientType:       string;
  status:           string;
  allocatedMinutes: number;
  usedMinutes:      number;
  remainingMinutes: number;
  createdAt:        string;
};

export function EmployeesTab() {
  const [dept, setDept]               = useState<Department | null>(null);
  const [ent, setEnt]                 = useState<EnterpriseLite | null>(null);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [addOpen, setAddOpen]         = useState(false);
  const [bulkOpen, setBulkOpen]       = useState(false);
  const [inviteKey, setInviteKey]     = useState(0);
  const [refillTarget, setRefillTarget] = useState<Employee | null>(null);
  const [editTarget, setEditTarget]   = useState<Employee | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/department/employees", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        department?: Department; enterprise?: EnterpriseLite; employees?: Employee[]; error?: string;
      };
      if (!res.ok || !body.department || !body.employees) {
        setError(body.error ?? "Couldn't load department.");
        return;
      }
      setDept(body.department);
      setEnt(body.enterprise ?? null);
      setEmployees(body.employees);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load department.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const empTotals = useMemo(() => {
    let used = 0, allocated = 0;
    for (const e of employees) {
      used      += e.usedMinutes;
      allocated += e.allocatedMinutes;
    }
    return { used, allocated };
  }, [employees]);

  const toggleStatus = async (empId: string, currentlyActive: boolean) => {
    const next = currentlyActive ? "suspended" : "active";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this employee?`)) return;
    const res = await fetch(`/api/department/employees/${empId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };

  if (loading) {
    return (
      <p className="px-6 py-12 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <p className="px-6 py-12 text-center text-xs" style={{ color: "var(--primary)" }}>
        {error}
      </p>
    );
  }
  if (!dept) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <DetailCard
          title={dept.name}
          code={dept.departmentCode}
          subtitle={ent ? ent.name : undefined}
          badges={[{
            label: dept.status === "active" ? "Active" : "Suspended",
            tone:  dept.status === "active" ? "success" : "warning",
          }]}
          minutes={{ used: dept.usedMinutes, allocated: dept.allocatedMinutes }}
          rollupCaption={(() => {
            if (employees.length === 0) {
              return `${dept.allocatedMinutes.toLocaleString()} min in pool · 0 employees yet · ${dept.usedMinutes.toLocaleString()} used`;
            }
            const dist = empTotals.allocated;
            const remaining = Math.max(0, dept.allocatedMinutes - dist);
            return (
              `${dept.allocatedMinutes.toLocaleString()} allocated · ` +
              `${dist.toLocaleString()} distributed to ${employees.length} employee${employees.length === 1 ? "" : "s"} · ` +
              `${remaining.toLocaleString()} remaining · ` +
              `${dept.usedMinutes.toLocaleString()} used`
            );
          })()}
          footerHint="Deactivating an employee returns their remaining minutes to the department pool."
        />

        <EmployeeTable
          employees={employees}
          totals={empTotals}
          onAdd={() => setAddOpen(true)}
          onEdit={(e) => setEditTarget(e)}
          onRefill={(e) => setRefillTarget(e)}
          onToggleStatus={toggleStatus}
        />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-lg font-medium" style={{ color: "var(--text)" }}>Invitations</h2>
            <Button variant="secondary" iconLeft={<Upload size={15} />} onClick={() => setBulkOpen(true)}>Bulk add (CSV)</Button>
          </div>
          <InviteStatusTable reloadKey={inviteKey} />
        </section>
      </div>

      <AddEmployeeDrawer
        open={addOpen}
        deptRemainingMinutes={dept.remainingMinutes}
        onClose={() => setAddOpen(false)}
        onCreated={() => { setAddOpen(false); refresh(); setInviteKey((k) => k + 1); }}
      />
      <InviteFlow
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        variant="members"
        endpoint="/api/department/employees"
        title="Invite employees"
        onSent={() => { refresh(); setInviteKey((k) => k + 1); }}
      />
      <RefillEmployeeDrawer
        open={refillTarget !== null}
        empId={refillTarget?.id ?? null}
        empName={refillTarget?.displayName || refillTarget?.email}
        empCurrent={refillTarget ? {
          allocated: refillTarget.allocatedMinutes,
          used:      refillTarget.usedMinutes,
          remaining: refillTarget.remainingMinutes,
        } : undefined}
        deptRemaining={dept.remainingMinutes}
        onClose={() => setRefillTarget(null)}
        onRefilled={() => { setRefillTarget(null); refresh(); }}
      />
      {editTarget && (
        <EditNameDrawer
          open={editTarget !== null}
          title="Edit employee name"
          label="Employee name"
          currentName={editTarget.displayName}
          endpoint={`/api/department/employees/${editTarget.id}`}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function EmployeeTable({
  employees, totals, onAdd, onEdit, onRefill, onToggleStatus,
}: {
  employees: Employee[];
  totals: { used: number; allocated: number };
  onAdd: () => void;
  onEdit: (e: Employee) => void;
  onRefill: (e: Employee) => void;
  onToggleStatus: (id: string, currentlyActive: boolean) => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          Employees ({employees.length})
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          <Plus className="size-3.5" /> Add Employee
        </button>
      </header>
      {employees.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No employees yet. Click <strong>Add Employee</strong> to invite one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Minutes (used / allocated)</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const active = e.status === "active";
                return (
                  <tr key={e.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>{e.displayName || "—"}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>{e.email}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                      {e.usedMinutes.toLocaleString()} / {e.allocatedMinutes.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                        style={{
                          color: active ? "#3dcb7e" : "var(--text-muted)",
                          background: active
                            ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                            : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                        }}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <RowIcon title="Edit name" onClick={() => onEdit(e)}>
                          <Pencil className="size-3.5" />
                        </RowIcon>
                        <RowIcon title="Refill minutes" onClick={() => onRefill(e)}>
                          <Coins className="size-3.5" />
                        </RowIcon>
                        <RowIcon
                          title={active ? "Deactivate" : "Reactivate"}
                          onClick={() => onToggleStatus(e.id, active)}
                        >
                          {active ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                        </RowIcon>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                <td colSpan={2} className="px-4 py-2.5 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                  Total
                </td>
                <td className="px-4 py-2.5 text-sm font-medium" style={{ color: "var(--text)" }}>
                  {totals.used.toLocaleString()} / {totals.allocated.toLocaleString()}
                </td>
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RowIcon({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/5"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}
