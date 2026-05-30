"use client";

/*
 * Enterprise tab — 2-sidebar drill-down for the redesigned super-admin
 * panel.
 *
 *   Sidebar 1: enterprises (organic + inorganic, with rolled-up minutes
 *              derived from their departments)
 *   Sidebar 2: departments of the selected enterprise
 *   Main:      department detail card + employees table
 *
 * Parent minutes are computed from children (per spec §1 rollup math),
 * not from the org row's own allocated_minutes field. The API does
 * return enterprise-level minutes, but we ignore them in favour of the
 * derived sum so the math can't disagree across surfaces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Mail, Power, PowerOff, Pencil } from "lucide-react";
import { Sidebar } from "@/app/_components/admin-v2/Sidebar";
import { MinutesBar } from "@/app/_components/admin-v2/MinutesBar";
import { DetailCard, type Badge } from "@/app/_components/admin-v2/DetailCard";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { EditNameDrawer } from "@/app/_components/admin-v2/EditNameDrawer";
import { AddEnterpriseDrawer } from "./_drawers/AddEnterpriseDrawer";
import { AddDepartmentDrawer } from "./_drawers/AddDepartmentDrawer";
import { AddEmployeeDrawer } from "./_drawers/AddEmployeeDrawer";
import { AdminRefillDrawer, type RefillTarget } from "./_drawers/AdminRefillDrawer";
import { AssignAdminDrawer } from "./_drawers/AssignAdminDrawer";
import { AssignEnterpriseAdminDrawer } from "./_drawers/AssignEnterpriseAdminDrawer";

type Member = {
  id: string; email: string; displayName: string;
  roles: string[]; primaryRole: string | null;
  status: "ACTIVE" | "DEACTIVATED";
};
type Department = {
  id: string; name: string; departmentCode: string;
  status: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  memberCount: number;
};
type Enterprise = {
  id: string; name: string;
  primaryDomain: string | null;
  status: string;
  enterpriseType: "organic" | "inorganic";
  resellerName: string | null;
  /** The org's own pool — set when the org was created / refilled. */
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  members: Member[];
  departments: Department[];
};
type Employee = {
  id: string; displayName: string; email: string;
  primaryRole: string | null; clientType: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  status: string; lastSignIn: string | null;
};

export function EnterpriseTab() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [selectedEntId,  setEntId]  = useState<string | null>(null);
  const [selectedDeptId, setDeptId] = useState<string | null>(null);

  const [addEnt,  setAddEnt]  = useState(false);
  const [addDept, setAddDept] = useState(false);
  const [addEmp,  setAddEmp]  = useState(false);
  const [editingEnt,  setEditingEnt]  = useState(false);
  const [editingDept, setEditingDept] = useState(false);
  const [refillTarget, setRefillTarget] = useState<RefillTarget | null>(null);
  const [assignAdmin, setAssignAdmin] = useState(false);
  const [addEntAdmin, setAddEntAdmin] = useState(false);

  // ─ Employees + admin for the selected department (lazy load) ────────
  const [employees, setEmployees]       = useState<Employee[]>([]);
  const [deptAdmin, setDeptAdmin]       = useState<Employee | null>(null);
  const [empLoading, setEmpLoading]     = useState(false);
  const [empError,   setEmpError]       = useState<string | null>(null);
  const [empRefreshTick, bumpEmpTick]   = useState(0);
  const refreshEmployees = useCallback(() => bumpEmpTick((t) => t + 1), []);

  // ─ Load all enterprises ─────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/admin/orgs", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { orgs?: Enterprise[]; error?: string };
      if (!res.ok || !body.orgs) {
        setError(body.error ?? "Couldn't load enterprises.");
        return;
      }
      setEnterprises(body.orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load enterprises.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // ─ Selection helpers ────────────────────────────────────────────────
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
          `/api/admin/orgs/${selectedEntId}/departments/${selectedDeptId}/employees`,
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
  }, [selectedEntId, selectedDeptId, empRefreshTick]);

  // ─ Derived rollups ──────────────────────────────────────────────────
  // For each enterprise we track:
  //   • the org's own pool (the 10,000 you allocated at create-time)
  //   • how much of that has been distributed down to departments
  //   • how much sits undistributed in the org pool
  // The Enterprise card uses the org pool for its primary number — the
  // dept distribution + remainder show up in the caption.
  const entSummaries = useMemo(() => {
    const map = new Map<string, {
      pool:          { used: number; allocated: number };
      distributed:   { used: number; allocated: number };
      deptCount:     number;
    }>();
    for (const e of enterprises) {
      let dUsed = 0, dAllocated = 0;
      for (const d of e.departments) {
        dUsed      += d.usedMinutes;
        dAllocated += d.allocatedMinutes;
      }
      map.set(e.id, {
        pool:        { used: e.usedMinutes,      allocated: e.allocatedMinutes },
        distributed: { used: dUsed,              allocated: dAllocated },
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

  // ─ Mutations: enterprise + department status / delete ───────────────
  const setOrgStatus = async (orgId: string, status: "active" | "suspended") => {
    const res = await fetch(`/api/admin/orgs/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const deleteOrg = async (orgId: string) => {
    if (!confirm("Delete this enterprise? Members will be detached.")) return;
    const res = await fetch(`/api/admin/orgs/${orgId}`, { method: "DELETE" });
    if (res.ok) {
      setEntId(null);
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Delete failed.");
  };
  const setDeptStatus = async (deptId: string, status: "active" | "suspended") => {
    if (!selectedEntId) return;
    const res = await fetch(
      `/api/admin/orgs/${selectedEntId}/departments/${deptId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const deleteDept = async (deptId: string) => {
    if (!selectedEntId) return;
    if (!confirm("Delete this department? Employees will be detached.")) return;
    const res = await fetch(
      `/api/admin/orgs/${selectedEntId}/departments/${deptId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setDeptId(null);
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Delete failed.");
  };
  const detachEmployee = async (empId: string) => {
    if (!selectedEntId || !selectedDeptId) return;
    if (!confirm("Remove this employee from the department?")) return;
    const res = await fetch(
      `/api/admin/orgs/${selectedEntId}/departments/${selectedDeptId}/employees/${empId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      refreshEmployees();
      refresh();   // dept member-count + minutes may have shifted
    } else alert((await res.json().catch(() => ({}))).error ?? "Remove failed.");
  };
  const removeEnterpriseAdmin = async (userId: string) => {
    if (!selectedEntId) return;
    if (!confirm("Remove this user as enterprise admin?")) return;
    const res = await fetch(`/api/admin/orgs/${selectedEntId}/admins/${userId}`, {
      method: "DELETE",
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Remove failed.");
  };
  const resendEmployeeInvite = async (empId: string) => {
    const res = await fetch(`/api/admin/users/${empId}/resend-invite`, { method: "POST" });
    if (res.ok) alert("Invite resent.");
    else alert((await res.json().catch(() => ({}))).error ?? "Resend failed.");
  };
  const toggleEmployeeStatus = async (empId: string, currentlyActive: boolean) => {
    const next = currentlyActive ? "DEACTIVATED" : "ACTIVE";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this employee's sign-in access?`)) return;
    const res = await fetch(`/api/admin/users/${empId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) refreshEmployees();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };

  // ─ Render ───────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar 1 — enterprises */}
      <Sidebar
        title="Enterprises"
        searchPlaceholder="Search enterprises…"
        items={enterprises.map((e) => ({
          id:     e.id,
          label:  e.name,
          search: `${e.name} ${e.resellerName ?? ""} ${e.enterpriseType}`,
          _data:  e,
        }))}
        selectedId={selectedEntId}
        onSelect={(it) => {
          // Always clear the dept selection — clicking an enterprise (even
          // the already-selected one) is how the user "navigates back" to
          // the enterprise overview from a dept-detail view.
          setDeptId(null);
          setEmployees([]);
          setDeptAdmin(null);
          setEmpError(null);
          setEntId(it.id);
        }}
        emptyMessage={loading ? "Loading…" : (error ?? "No enterprises yet.")}
        footer={
          <button
            type="button"
            onClick={() => setAddEnt(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Add Enterprise
          </button>
        }
        renderRow={(it) => {
          const e = (it as unknown as { _data: Enterprise })._data;
          const r = entSummaries.get(e.id)?.pool ?? { used: 0, allocated: 0 };
          const isReseller = e.enterpriseType === "inorganic";
          return (
            <div
              className="flex flex-col gap-1.5"
              style={{
                // Subtle left-accent stripe for reseller-owned orgs so they
                // stand out at a glance in the list.
                borderLeft: isReseller
                  ? "2px solid color-mix(in srgb, var(--primary) 70%, transparent)"
                  : "2px solid transparent",
                paddingLeft: 8,
                marginLeft:  -8,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {e.name}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: e.status === "active" ? "#3dcb7e" : "var(--text-muted)" }}
                />
              </div>
              {isReseller && e.resellerName ? (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className="truncate rounded px-1.5 py-px font-semibold tracking-wider uppercase"
                    style={{
                      color:      "var(--primary)",
                      background: "color-mix(in srgb, var(--primary) 16%, transparent)",
                    }}
                  >
                    via {e.resellerName}
                  </span>
                  <span className="tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                    · {e.departments.length} dept{e.departments.length === 1 ? "" : "s"}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                  Direct · {e.departments.length} dept{e.departments.length === 1 ? "" : "s"}
                </div>
              )}
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
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
              style={{ background: "var(--primary)", color: "#fff" }}
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
              label:   "Enterprises",
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
          <EmptyState
            title="Select an enterprise"
            blurb="Pick an enterprise on the left to view its departments and rollups."
          />
        )}
        {selectedEnt && !selectedDept && (
          <div className="flex flex-col gap-6">
            <EnterpriseSummary
              ent={selectedEnt}
              summary={entSummaries.get(selectedEnt.id)}
              onEdit={() => setEditingEnt(true)}
              onToggle={(s) => setOrgStatus(selectedEnt.id, s)}
              onDelete={() => deleteOrg(selectedEnt.id)}
              onAddMinutes={() => setRefillTarget({
                title:      `Add minutes — ${selectedEnt.name}`,
                endpoint:   `/api/admin/orgs/${selectedEnt.id}/refill`,
                allocated:  selectedEnt.allocatedMinutes,
                remaining:  selectedEnt.remainingMinutes,
                sourceNote: selectedEnt.enterpriseType === "organic"
                  ? "Minted to this enterprise's pool."
                  : `Drawn from ${selectedEnt.resellerName ?? "the channel partner"}'s pool — top the partner up first if it's short.`,
              })}
            />
            <EnterpriseAdminsSection
              admins={selectedEnt.members.filter((m) => m.roles.includes("enterprise_admin"))}
              onAdd={() => setAddEntAdmin(true)}
              onResend={resendEmployeeInvite}
              onToggleStatus={toggleEmployeeStatus}
              onRemove={removeEnterpriseAdmin}
            />
          </div>
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
              rollupCaption={deptDistCaption(selectedDept, employeeTotals, employees.length)}
              actions={
                <DetailActions
                  statusActive={selectedDept.status === "active"}
                  onEdit={() => setEditingDept(true)}
                  onToggle={() => setDeptStatus(selectedDept.id, selectedDept.status === "active" ? "suspended" : "active")}
                  onDelete={() => deleteDept(selectedDept.id)}
                />
              }
            />
            <DepartmentAdminCard
              admin={deptAdmin}
              deptActive={selectedDept.status === "active"}
              onResend={resendEmployeeInvite}
              onToggleStatus={toggleEmployeeStatus}
              onRemove={detachEmployee}
              onAssign={() => setAssignAdmin(true)}
            />
            <EmployeeTable
              loading={empLoading}
              error={empError}
              employees={employees}
              totals={employeeTotals}
              onAdd={() => setAddEmp(true)}
              onResend={resendEmployeeInvite}
              onToggleStatus={toggleEmployeeStatus}
              onRemove={detachEmployee}
            />
          </div>
        )}
      </main>

      <AddEnterpriseDrawer
        open={addEnt}
        onClose={() => setAddEnt(false)}
        onCreated={(orgId) => {
          setAddEnt(false);
          refresh().then(() => setEntId(orgId));
        }}
      />
      <AddDepartmentDrawer
        open={addDept}
        orgId={selectedEntId}
        onClose={() => setAddDept(false)}
        onCreated={(deptId) => {
          setAddDept(false);
          refresh().then(() => setDeptId(deptId));
        }}
      />
      <AddEmployeeDrawer
        open={addEmp}
        orgId={selectedEntId}
        deptId={selectedDeptId}
        deptRemainingMinutes={selectedDept?.remainingMinutes}
        onClose={() => setAddEmp(false)}
        onCreated={() => {
          setAddEmp(false);
          refreshEmployees();
          refresh();
        }}
      />
      {selectedEnt && (
        <EditNameDrawer
          open={editingEnt}
          title="Edit enterprise"
          label="Enterprise name"
          currentName={selectedEnt.name}
          endpoint={`/api/admin/orgs/${selectedEnt.id}`}
          onClose={() => setEditingEnt(false)}
          onSaved={() => { setEditingEnt(false); refresh(); }}
        />
      )}
      {selectedEntId && selectedDept && (
        <EditNameDrawer
          open={editingDept}
          title="Edit department"
          label="Department name"
          currentName={selectedDept.name}
          endpoint={`/api/admin/orgs/${selectedEntId}/departments/${selectedDept.id}`}
          onClose={() => setEditingDept(false)}
          onSaved={() => { setEditingDept(false); refresh(); }}
        />
      )}
      <AdminRefillDrawer
        target={refillTarget}
        onClose={() => setRefillTarget(null)}
        onRefilled={() => { setRefillTarget(null); refresh(); }}
      />
      <AssignAdminDrawer
        open={assignAdmin}
        orgId={selectedEntId}
        deptId={selectedDeptId}
        employees={employees.map((e) => ({ id: e.id, displayName: e.displayName, email: e.email }))}
        onClose={() => setAssignAdmin(false)}
        onAssigned={() => { setAssignAdmin(false); refreshEmployees(); refresh(); }}
      />
      <AssignEnterpriseAdminDrawer
        open={addEntAdmin}
        orgId={selectedEntId}
        candidates={(selectedEnt?.members ?? [])
          .filter((m) => !m.roles.includes("enterprise_admin"))
          .map((m) => ({ id: m.id, displayName: m.displayName, email: m.email }))}
        onClose={() => setAddEntAdmin(false)}
        onAssigned={() => { setAddEntAdmin(false); refresh(); }}
      />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function EmptyState({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16 text-center">
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {blurb}
        </p>
      </div>
    </div>
  );
}

function EnterpriseSummary({
  ent, summary, onEdit, onToggle, onDelete, onAddMinutes,
}: {
  ent: Enterprise;
  summary?: {
    pool:        { used: number; allocated: number };
    distributed: { used: number; allocated: number };
    deptCount:   number;
  };
  onEdit:   () => void;
  onToggle: (next: "active" | "suspended") => void;
  onDelete: () => void;
  onAddMinutes: () => void;
}) {
  const badges: Badge[] = [
    { label: ent.enterpriseType === "organic" ? "Organic" : "Inorganic", tone: "neutral" },
    {
      label: ent.status === "active" ? "Active" : "Suspended",
      tone:  ent.status === "active" ? "success" : "warning",
    },
  ];

  const pool        = summary?.pool        ?? { used: ent.usedMinutes, allocated: ent.allocatedMinutes };
  const distributed = summary?.distributed ?? { used: 0, allocated: 0 };
  const deptCount   = summary?.deptCount   ?? ent.departments.length;
  const remaining   = Math.max(0, pool.allocated - distributed.allocated);

  // Caption shows all four numbers — allocated / distributed / remaining
  // / used — per the user's spec.
  const caption =
    deptCount === 0
      ? `${pool.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} min in pool · 0 departments yet · ${pool.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`
      : `${pool.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} allocated · ` +
        `${distributed.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} distributed to ${deptCount} department${deptCount === 1 ? "" : "s"} · ` +
        `${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining · ` +
        `${pool.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`;

  return (
    <DetailCard
      title={ent.name}
      subtitle={ent.resellerName ? `via ${ent.resellerName}` : undefined}
      badges={badges}
      description={ent.primaryDomain ? `Domain: ${ent.primaryDomain}` : undefined}
      minutes={pool}
      rollupCaption={caption}
      actions={
        <DetailActions
          statusActive={ent.status === "active"}
          onEdit={onEdit}
          onAddMinutes={onAddMinutes}
          onToggle={() => onToggle(ent.status === "active" ? "suspended" : "active")}
          onDelete={onDelete}
        />
      }
    />
  );
}

function DetailActions({
  statusActive, onEdit, onToggle, onDelete, onAddMinutes,
}: {
  statusActive: boolean;
  onEdit?:   () => void;
  onToggle: () => void;
  onDelete: () => void;
  onAddMinutes?: () => void;
}) {
  return (
    <>
      {onAddMinutes && statusActive && (
        <button
          type="button"
          onClick={onAddMinutes}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          <Plus className="size-3" /> Add minutes
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Pencil className="size-3" /> Edit
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        {statusActive ? "Deactivate" : "Activate"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
        style={{
          borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)",
          color:       "var(--primary)",
        }}
      >
        Delete
      </button>
    </>
  );
}

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
          <div className="flex items-center gap-1">
            {admin.status === "invited" && (
              <RowIcon title="Resend invite email" onClick={() => onResend(admin.id)}>
                <Mail className="size-3.5" />
              </RowIcon>
            )}
            <RowIcon
              title={admin.status === "active" ? "Deactivate" : "Reactivate"}
              onClick={() => onToggleStatus(admin.id, admin.status === "active")}
            >
              {admin.status === "active"
                ? <PowerOff className="size-3.5" />
                : <Power className="size-3.5" />}
            </RowIcon>
            <RowIcon
              title="Remove as department admin"
              danger
              onClick={() => onRemove(admin.id)}
            >
              <Trash2 className="size-3.5" />
            </RowIcon>
          </div>
        </div>
      )}
    </section>
  );
}

function EnterpriseAdminsSection({
  admins, onAdd, onResend, onToggleStatus, onRemove,
}: {
  admins: Member[];
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
      <header className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          Enterprise admins ({admins.length})
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          <Plus className="size-3.5" /> Add admin
        </button>
      </header>
      {admins.length === 0 ? (
        <p className="px-4 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No enterprise admin assigned. Use <span style={{ color: "var(--text)" }}>Add admin</span> above to
          promote an existing member or invite someone by email.
        </p>
      ) : (
        <ul className="flex flex-col">
          {admins.map((m) => {
            const active = m.status === "ACTIVE";
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: "color-mix(in srgb, var(--primary) 16%, transparent)",
                    color:      "var(--primary)",
                  }}
                >
                  {memberInitials(m)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                    {m.displayName || "—"}
                  </div>
                  <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {m.email}
                  </div>
                </div>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                  style={{
                    color:      "var(--primary)",
                    background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                  }}
                >
                  Enterprise admin
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                  style={{
                    color: active ? "#3dcb7e" : "var(--text-muted)",
                    background: active
                      ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                      : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                  }}
                >
                  {active ? "active" : "suspended"}
                </span>
                <div className="flex items-center gap-1">
                  <RowIcon title="Resend invite email" onClick={() => onResend(m.id)}>
                    <Mail className="size-3.5" />
                  </RowIcon>
                  <RowIcon
                    title={active ? "Deactivate" : "Reactivate"}
                    onClick={() => onToggleStatus(m.id, active)}
                  >
                    {active ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                  </RowIcon>
                  <RowIcon title="Remove as enterprise admin" danger onClick={() => onRemove(m.id)}>
                    <Trash2 className="size-3.5" />
                  </RowIcon>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function memberInitials(m: Member): string {
  const src = m.displayName || m.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

function RowIcon({
  title, onClick, children, danger,
}: {
  title:    string;
  onClick:  () => void;
  children: React.ReactNode;
  danger?:  boolean;
}) {
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

/**
 * Build the caption shown under a department detail card.
 *
 *   "500 allocated · 200 distributed to 1 employee · 300 remaining · 50 used"
 *
 * Surfaces all four numbers per the user's spec:
 *   • allocated  = dept's own pool (set when transfer_to_department runs)
 *   • distributed = sum of employee.allocated_minutes
 *   • remaining   = allocated − distributed (what's still in the dept pool)
 *   • used        = dept.used_minutes (rolled up from employee usage via end_session)
 */
function deptDistCaption(
  dept: Department,
  empTotals: { allocated: number; used: number },
  empCount: number,
): string {
  if (empCount === 0) {
    return `${dept.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} min in pool · 0 employees yet · ${dept.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`;
  }
  const remaining = Math.max(0, dept.allocatedMinutes - empTotals.allocated);
  return (
    `${dept.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} allocated · ` +
    `${empTotals.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} distributed to ${empCount} employee${empCount === 1 ? "" : "s"} · ` +
    `${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining · ` +
    `${dept.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`
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
  onAdd, onResend, onToggleStatus, onRemove,
}: {
  loading: boolean;
  error: string | null;
  employees: Employee[];
  totals: { used: number; allocated: number };
  onAdd: () => void;
  onResend: (empId: string) => void;
  onToggleStatus: (empId: string, currentlyActive: boolean) => void;
  onRemove: (empId: string) => void;
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
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
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
                    {e.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {e.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {e.status === "invited" && (
                        <RowIcon
                          title="Resend invite email"
                          onClick={() => onResend(e.id)}
                        >
                          <Mail className="size-3.5" />
                        </RowIcon>
                      )}
                      <RowIcon
                        title={e.status === "active" ? "Deactivate" : "Reactivate"}
                        onClick={() => onToggleStatus(e.id, e.status === "active")}
                      >
                        {e.status === "active"
                          ? <PowerOff className="size-3.5" />
                          : <Power className="size-3.5" />}
                      </RowIcon>
                      <RowIcon
                        title="Remove from department"
                        danger
                        onClick={() => onRemove(e.id)}
                      >
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
                  {totals.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {totals.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
