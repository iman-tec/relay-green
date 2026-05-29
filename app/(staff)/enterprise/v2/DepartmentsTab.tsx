"use client";

/*
 * Enterprise admin Departments tab — single sidebar + main area.
 *
 *   Sidebar: this org's departments
 *   Main:    no dept selected → enterprise pool summary card
 *            dept selected     → dept detail + dept admin + employees
 *
 * Mirrors /admin/v2's Enterprise tab patterns:
 *   • Mutually-exclusive main views
 *   • Click same dept = clear deeper selections
 *   • Shared Breadcrumb above the main area
 *   • Per-row Resend / Deactivate / Remove icons
 *   • Parent minutes = its own pool, caption shows distribution to children
 *
 * Endpoints: /api/enterprise/departments (+ /[id], /[id]/employees,
 * /[id]/employees/[empId]). Same `requireEnterpriseAdmin` gate everywhere.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Mail, Power, PowerOff, Trash2, Pencil } from "lucide-react";
import { Sidebar } from "@/app/_components/admin-v2/Sidebar";
import { MinutesBar } from "@/app/_components/admin-v2/MinutesBar";
import { DetailCard } from "@/app/_components/admin-v2/DetailCard";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { EditNameDrawer } from "@/app/_components/admin-v2/EditNameDrawer";
import { AddDepartmentDrawer } from "./_drawers/AddDepartmentDrawer";
import { AddEmployeeDrawer } from "./_drawers/AddEmployeeDrawer";
import { AssignAdminDrawer } from "./_drawers/AssignAdminDrawer";
import { RefillDepartmentDrawer } from "./_drawers/RefillDepartmentDrawer";

type Enterprise = {
  id: string;
  name: string;
  enterpriseCode: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
};
type Department = {
  id: string;
  name: string;
  departmentCode: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  adminUserId: string | null;
  totalEmployees: number;
  activeEmployees: number;
  createdAt: string;
};
type Employee = {
  id: string;
  displayName: string;
  email: string;
  primaryRole: string | null;
  clientType: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  status: string;
  lastSignIn: string | null;
};

export function DepartmentsTab() {
  const [ent, setEnt]                     = useState<Enterprise | null>(null);
  const [depts, setDepts]                 = useState<Department[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);

  const [selDeptId, setDeptId]            = useState<string | null>(null);
  const [addDept, setAddDept]             = useState(false);
  const [addEmp, setAddEmp]               = useState(false);
  const [editDept, setEditDept]           = useState(false);
  const [assignAdmin, setAssignAdmin]     = useState(false);
  const [refillDept, setRefillDept]       = useState(false);

  const [employees, setEmployees]         = useState<Employee[]>([]);
  const [deptAdmin, setDeptAdmin]         = useState<Employee | null>(null);
  const [empLoading, setEmpLoading]       = useState(false);
  const [empError, setEmpError]           = useState<string | null>(null);
  const [empTick, bumpEmpTick]            = useState(0);
  const refreshEmployees = useCallback(() => bumpEmpTick((t) => t + 1), []);

  // ─ Load: enterprise + departments ─────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/enterprise/departments", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        enterprise?: Enterprise; departments?: Department[]; error?: string;
      };
      if (!res.ok || !body.enterprise || !body.departments) {
        setError(body.error ?? "Couldn't load departments.");
        return;
      }
      setEnt(body.enterprise);
      setDepts(body.departments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load departments.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const selDept = depts.find((d) => d.id === selDeptId) ?? null;

  // ─ Load employees for the selected dept ────────────────────────────
  useEffect(() => {
    if (!selDeptId) {
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
          `/api/enterprise/departments/${selDeptId}/employees`,
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
  }, [selDeptId, empTick]);

  const empTotals = useMemo(() => {
    let used = 0, allocated = 0;
    for (const e of employees) {
      used      += e.usedMinutes;
      allocated += e.allocatedMinutes;
    }
    return { used, allocated };
  }, [employees]);

  // ─ Mutations ───────────────────────────────────────────────────────
  const setDeptStatus = async (deptId: string, status: "active" | "suspended") => {
    const res = await fetch(`/api/enterprise/departments/${deptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const detachEmployee = async (empId: string) => {
    if (!selDeptId) return;
    if (!confirm("Remove this user from the department?")) return;
    const res = await fetch(
      `/api/enterprise/departments/${selDeptId}/employees/${empId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      refreshEmployees();
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Remove failed.");
  };
  const resendInvite = async (id: string) => {
    const res = await fetch(`/api/enterprise/members/${id}/resend-invite`, { method: "POST" });
    if (res.ok) alert("Invite resent.");
    else alert((await res.json().catch(() => ({}))).error ?? "Resend failed.");
  };
  const toggleStatus = async (id: string, currentlyActive: boolean) => {
    const next = currentlyActive ? "DEACTIVATED" : "ACTIVE";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this user's sign-in access?`)) return;
    const res = await fetch(`/api/enterprise/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) refreshEmployees();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };

  // ─ Distribution math (for the enterprise summary caption) ──────────
  const distributed = useMemo(() => {
    let allocated = 0;
    for (const d of depts) allocated += d.allocatedMinutes;
    return allocated;
  }, [depts]);

  // ─ Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      <Sidebar
        title="Departments"
        searchPlaceholder="Search departments…"
        width={280}
        items={depts.map((d) => ({
          id:     d.id,
          label:  d.name,
          search: `${d.name} ${d.departmentCode}`,
          _data:  d,
        }))}
        selectedId={selDeptId}
        onSelect={(it) => setDeptId(it.id)}
        emptyMessage={loading ? "Loading…" : (error ?? "No departments yet.")}
        footer={
          <button
            type="button"
            onClick={() => setAddDept(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Add Department
          </button>
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
                {d.totalEmployees} member{d.totalEmployees === 1 ? "" : "s"}
              </div>
              <MinutesBar used={d.usedMinutes} allocated={d.allocatedMinutes} size="sm" />
            </div>
          );
        }}
      />

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={(() => {
            const crumbs: Crumb[] = [{
              label:   ent?.name ?? "Enterprise",
              onClick: () => { setDeptId(null); setEmployees([]); setDeptAdmin(null); },
            }];
            if (selDept) crumbs.push({ label: selDept.name });
            return crumbs;
          })()}
        />

        {ent && !selDept && (
          <DetailCard
            title={ent.name}
            code={ent.enterpriseCode}
            badges={[{
              label: ent.status === "active" ? "Active" : "Suspended",
              tone:  ent.status === "active" ? "success" : "warning",
            }]}
            minutes={{ used: ent.usedMinutes, allocated: ent.allocatedMinutes }}
            rollupCaption={(() => {
              if (depts.length === 0) {
                return `${ent.allocatedMinutes.toLocaleString()} min in pool · 0 departments yet · ${ent.usedMinutes.toLocaleString()} used`;
              }
              const remaining = Math.max(0, ent.allocatedMinutes - distributed);
              return (
                `${ent.allocatedMinutes.toLocaleString()} allocated · ` +
                `${distributed.toLocaleString()} distributed to ${depts.length} department${depts.length === 1 ? "" : "s"} · ` +
                `${remaining.toLocaleString()} remaining · ` +
                `${ent.usedMinutes.toLocaleString()} used`
              );
            })()}
            footerHint="Pick a department on the left to manage its admin + employees."
          />
        )}

        {selDept && (
          <div className="flex flex-col gap-6">
            <DetailCard
              title={selDept.name}
              code={selDept.departmentCode}
              badges={[{
                label: selDept.status === "active" ? "Active" : "Suspended",
                tone:  selDept.status === "active" ? "success" : "warning",
              }]}
              minutes={{
                used:      selDept.usedMinutes,
                allocated: selDept.allocatedMinutes,
              }}
              rollupCaption={(() => {
                if (employees.length === 0) {
                  return `${selDept.allocatedMinutes.toLocaleString()} min in pool · 0 employees yet · ${selDept.usedMinutes.toLocaleString()} used`;
                }
                const remaining = Math.max(0, selDept.allocatedMinutes - empTotals.allocated);
                return (
                  `${selDept.allocatedMinutes.toLocaleString()} allocated · ` +
                  `${empTotals.allocated.toLocaleString()} distributed to ${employees.length} employee${employees.length === 1 ? "" : "s"} · ` +
                  `${remaining.toLocaleString()} remaining · ` +
                  `${selDept.usedMinutes.toLocaleString()} used`
                );
              })()}
              actions={
                <>
                  {selDept.status === "active" && (
                    <button
                      type="button"
                      onClick={() => setRefillDept(true)}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
                      style={{ background: "var(--primary)", color: "#fff" }}
                    >
                      <Plus className="size-3" /> Add minutes
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditDept(true)}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    <Pencil className="size-3" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeptStatus(selDept.id, selDept.status === "active" ? "suspended" : "active")}
                    className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {selDept.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </>
              }
              footerHint="Deactivating a department returns its remaining minutes to the enterprise pool."
            />

            <DepartmentAdminCard
              admin={deptAdmin}
              deptActive={selDept.status === "active"}
              onResend={resendInvite}
              onToggleStatus={toggleStatus}
              onRemove={detachEmployee}
              onAssign={() => setAssignAdmin(true)}
            />

            <EmployeeTable
              loading={empLoading}
              error={empError}
              employees={employees}
              totals={empTotals}
              onAdd={() => setAddEmp(true)}
              onResend={resendInvite}
              onToggleStatus={toggleStatus}
              onRemove={detachEmployee}
            />
          </div>
        )}
      </main>

      <AddDepartmentDrawer
        open={addDept}
        enterpriseRemainingMinutes={ent?.remainingMinutes}
        onClose={() => setAddDept(false)}
        onCreated={(deptId) => {
          setAddDept(false);
          refresh().then(() => setDeptId(deptId));
        }}
      />
      <AddEmployeeDrawer
        open={addEmp}
        deptId={selDeptId}
        deptRemainingMinutes={selDept?.remainingMinutes}
        onClose={() => setAddEmp(false)}
        onCreated={() => {
          setAddEmp(false);
          refreshEmployees();
          refresh();
        }}
      />
      {selDept && (
        <EditNameDrawer
          open={editDept}
          title="Edit department"
          label="Department name"
          currentName={selDept.name}
          endpoint={`/api/enterprise/departments/${selDept.id}`}
          onClose={() => setEditDept(false)}
          onSaved={() => { setEditDept(false); refresh(); }}
        />
      )}
      <AssignAdminDrawer
        open={assignAdmin}
        deptId={selDeptId}
        employees={employees.map((e) => ({ id: e.id, displayName: e.displayName, email: e.email }))}
        onClose={() => setAssignAdmin(false)}
        onAssigned={() => {
          setAssignAdmin(false);
          refreshEmployees();
          refresh();
        }}
      />
      <RefillDepartmentDrawer
        open={refillDept}
        deptId={selDeptId}
        deptName={selDept?.name ?? ""}
        deptAllocated={selDept?.allocatedMinutes ?? 0}
        deptRemaining={selDept?.remainingMinutes ?? 0}
        enterpriseRemaining={ent?.remainingMinutes ?? 0}
        onClose={() => setRefillDept(false)}
        onRefilled={() => {
          setRefillDept(false);
          refresh();
        }}
      />
    </div>
  );
}

// ── Subcomponents (mirror /admin/v2 patterns so the tabs feel identical) ─

function DepartmentAdminCard({
  admin, deptActive, onResend, onToggleStatus, onRemove, onAssign,
}: {
  admin: Employee | null;
  deptActive: boolean;
  onResend: (id: string) => void;
  onToggleStatus: (id: string, currentlyActive: boolean) => void;
  onRemove: (id: string) => void;
  onAssign: () => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          Department admin
        </span>
        {!admin && (
          <button
            type="button"
            onClick={onAssign}
            disabled={!deptActive}
            title={deptActive ? "Assign a department admin" : "Reactivate the department first"}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Assign admin
          </button>
        )}
      </header>
      {!admin ? (
        <p className="px-4 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No admin assigned. Promote an existing employee or invite someone by email with{" "}
          <span style={{ color: "var(--text)" }}>Assign admin</span> above.
        </p>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
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
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{ color: "var(--primary)", background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}>
            Dept admin
          </span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{
              color: admin.status === "active" ? "#3dcb7e" : "var(--text-muted)",
              background: admin.status === "active"
                ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
            }}>
            {admin.status}
          </span>
          <div className="flex items-center gap-1">
            <RowIcon title="Resend invite email" onClick={() => onResend(admin.id)}>
              <Mail className="size-3.5" />
            </RowIcon>
            <RowIcon
              title={admin.status === "active" ? "Deactivate" : "Reactivate"}
              onClick={() => onToggleStatus(admin.id, admin.status === "active")}
            >
              {admin.status === "active" ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
            </RowIcon>
            <RowIcon title="Remove as department admin" danger onClick={() => onRemove(admin.id)}>
              <Trash2 className="size-3.5" />
            </RowIcon>
          </div>
        </div>
      )}
    </section>
  );
}

function EmployeeTable({
  loading, error, employees, totals,
  onAdd, onResend, onToggleStatus, onRemove,
}: {
  loading: boolean;
  error: string | null;
  employees: Employee[];
  totals: { used: number; allocated: number };
  onAdd: () => void;
  onResend: (id: string) => void;
  onToggleStatus: (id: string, currentlyActive: boolean) => void;
  onRemove: (id: string) => void;
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
      {loading && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</p>
      )}
      {!loading && error && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--primary)" }}>{error}</p>
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
              <tr className="text-left text-[11px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Minutes (used / allocated)</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>{e.displayName || "—"}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>{e.email}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                    {e.usedMinutes.toLocaleString()} / {e.allocatedMinutes.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                      style={{
                        color: e.status === "active" ? "#3dcb7e" : "var(--text-muted)",
                        background: e.status === "active"
                          ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                          : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                      }}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <RowIcon title="Resend invite email" onClick={() => onResend(e.id)}>
                        <Mail className="size-3.5" />
                      </RowIcon>
                      <RowIcon
                        title={e.status === "active" ? "Deactivate" : "Reactivate"}
                        onClick={() => onToggleStatus(e.id, e.status === "active")}
                      >
                        {e.status === "active" ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                      </RowIcon>
                      <RowIcon title="Remove from department" danger onClick={() => onRemove(e.id)}>
                        <Trash2 className="size-3.5" />
                      </RowIcon>
                    </div>
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
  title, onClick, children, danger,
}: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/5"
      style={{ color: danger ? "var(--primary)" : "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function initialsFor(e: Employee): string {
  const src = e.displayName || e.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

