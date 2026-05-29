"use client";

/*
 * Reseller tab — 3-sidebar drill-down.
 *
 *   Sidebar 1: resellers (with rolled-up minutes from their enterprises)
 *   Sidebar 2: enterprises under the selected reseller
 *   Sidebar 3: departments under the selected enterprise
 *   Main:      stacked detail cards (reseller → enterprise → department)
 *              plus an employees table at the bottom.
 *
 * As you drill down, more cards appear below — clicking a level higher
 * in the sidebars collapses the lower levels (mirrors the Enterprise
 * tab's "click back to enterprise" behavior).
 *
 * Data: pulls /api/admin/resellers (which already nests enterprises) and
 * /api/admin/orgs (which already nests departments) in parallel. Employees
 * are loaded on-demand when a department is selected.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Mail, Power, PowerOff, Trash2, Pencil } from "lucide-react";
import { Sidebar } from "@/app/_components/admin-v2/Sidebar";
import { MinutesBar } from "@/app/_components/admin-v2/MinutesBar";
import { DetailCard, type Badge } from "@/app/_components/admin-v2/DetailCard";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { EditNameDrawer } from "@/app/_components/admin-v2/EditNameDrawer";
import { AddResellerDrawer } from "./_drawers/AddResellerDrawer";
import { AddEnterpriseDrawer } from "./_drawers/AddEnterpriseDrawer";
import { AddDepartmentDrawer } from "./_drawers/AddDepartmentDrawer";
import { AddEmployeeDrawer } from "./_drawers/AddEmployeeDrawer";
import { AdminRefillDrawer, type RefillTarget } from "./_drawers/AdminRefillDrawer";
import { AssignAdminDrawer } from "./_drawers/AssignAdminDrawer";

// ── Types from the existing endpoints ────────────────────────────────
type ResellerEnterprise = {
  id: string; name: string; primaryDomain: string | null;
  status: string; enterpriseCode: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
};
type Reseller = {
  id: string; name: string; email: string | null;
  resellerCode: string; commission: number;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  status: string;
  ownerUserId: string | null;
  totalEnterprises: number; activeEnterprises: number;
  enterprises: ResellerEnterprise[];
};

type OrgDepartment = {
  id: string; name: string; departmentCode: string;
  status: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  memberCount: number;
};
type Org = {
  id: string;
  resellerId: string | null;
  departments: OrgDepartment[];
};

type Employee = {
  id: string; displayName: string; email: string;
  primaryRole: string | null; clientType: string;
  allocatedMinutes: number; usedMinutes: number; remainingMinutes: number;
  status: string; lastSignIn: string | null;
};

export function ResellersTab() {
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [orgsByReseller, setOrgsByReseller] = useState<Map<string, Org[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [selResellerId, setResellerId] = useState<string | null>(null);
  const [selEntId,      setEntId]      = useState<string | null>(null);
  const [selDeptId,     setDeptId]     = useState<string | null>(null);

  const [addReseller, setAddReseller] = useState(false);
  const [addEnt,      setAddEnt]      = useState(false);
  const [addDept,     setAddDept]     = useState(false);
  const [addEmp,      setAddEmp]      = useState(false);
  const [editReseller, setEditReseller] = useState(false);
  const [editEnt,      setEditEnt]      = useState(false);
  const [editDept,     setEditDept]     = useState(false);
  const [refillTarget, setRefillTarget] = useState<RefillTarget | null>(null);
  const [assignAdmin, setAssignAdmin] = useState(false);

  // Employees for the selected department
  const [employees, setEmployees]       = useState<Employee[]>([]);
  const [deptAdmin, setDeptAdmin]       = useState<Employee | null>(null);
  const [empLoading, setEmpLoading]     = useState(false);
  const [empError,   setEmpError]       = useState<string | null>(null);
  const [empTick, bumpEmpTick]          = useState(0);
  const refreshEmployees = useCallback(() => bumpEmpTick((t) => t + 1), []);

  // ─ Refresh: pull resellers + orgs in parallel ──────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, oRes] = await Promise.all([
        fetch("/api/admin/resellers", { cache: "no-store" }),
        fetch("/api/admin/orgs",      { cache: "no-store" }),
      ]);
      const rBody = (await rRes.json().catch(() => ({}))) as { resellers?: Reseller[]; error?: string };
      const oBody = (await oRes.json().catch(() => ({}))) as { orgs?: Org[]; error?: string };
      if (!rRes.ok || !rBody.resellers) {
        setError(rBody.error ?? "Couldn't load channel partners.");
        return;
      }
      setResellers(rBody.resellers);
      const map = new Map<string, Org[]>();
      for (const o of (oBody.orgs ?? [])) {
        if (!o.resellerId) continue;
        const list = map.get(o.resellerId) ?? [];
        list.push(o);
        map.set(o.resellerId, list);
      }
      setOrgsByReseller(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load channel partners.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // ─ Selection lookups ───────────────────────────────────────────────
  const selReseller   = resellers.find((r) => r.id === selResellerId) ?? null;
  const resellerOrgs  = selResellerId ? (orgsByReseller.get(selResellerId) ?? []) : [];
  const selOrg        = resellerOrgs.find((o) => o.id === selEntId) ?? null;
  const enterpriseRow = selReseller?.enterprises.find((e) => e.id === selEntId) ?? null;
  const selDept       = selOrg?.departments.find((d) => d.id === selDeptId) ?? null;

  // ─ Employees fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selEntId || !selDeptId) {
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
          `/api/admin/orgs/${selEntId}/departments/${selDeptId}/employees`,
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
  }, [selEntId, selDeptId, empTick]);

  // ─ Derived rollups ─────────────────────────────────────────────────
  // For each enterprise: sum of its departments.
  // Note: parents (reseller, enterprise) display their own pool from
  // their respective DB row — not summed from children. Captions on the
  // detail cards explain how much has been distributed downward vs sits
  // undistributed in the pool. Summing children would hide the
  // undistributed remainder, which is what bit us before.

  const empTotals = useMemo(() => {
    let used = 0, allocated = 0;
    for (const e of employees) {
      used      += e.usedMinutes;
      allocated += e.allocatedMinutes;
    }
    return { used, allocated };
  }, [employees]);

  // ─ Mutations ───────────────────────────────────────────────────────
  const setResellerStatus = async (id: string, status: "active" | "suspended") => {
    const res = await fetch(`/api/admin/resellers/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const setOrgStatus = async (id: string, status: "active" | "suspended") => {
    const res = await fetch(`/api/admin/orgs/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const deleteOrg = async (id: string) => {
    if (!confirm("Delete this enterprise? Members will be detached.")) return;
    const res = await fetch(`/api/admin/orgs/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntId(null);
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Delete failed.");
  };
  const setDeptStatus = async (orgId: string, deptId: string, status: "active" | "suspended") => {
    const res = await fetch(`/api/admin/orgs/${orgId}/departments/${deptId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const deleteDept = async (orgId: string, deptId: string) => {
    if (!confirm("Delete this department? Employees will be detached.")) return;
    const res = await fetch(`/api/admin/orgs/${orgId}/departments/${deptId}`, { method: "DELETE" });
    if (res.ok) {
      setDeptId(null);
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Delete failed.");
  };
  const detachEmployee = async (empId: string) => {
    if (!selEntId || !selDeptId) return;
    if (!confirm("Remove this employee from the department?")) return;
    const res = await fetch(
      `/api/admin/orgs/${selEntId}/departments/${selDeptId}/employees/${empId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      refreshEmployees();
      refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Remove failed.");
  };
  const resendInvite = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}/resend-invite`, { method: "POST" });
    if (res.ok) alert("Invite resent.");
    else alert((await res.json().catch(() => ({}))).error ?? "Resend failed.");
  };
  const toggleEmployeeStatus = async (empId: string, currentlyActive: boolean) => {
    const next = currentlyActive ? "DEACTIVATED" : "ACTIVE";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this user's sign-in access?`)) return;
    const res = await fetch(`/api/admin/users/${empId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) refreshEmployees();
    else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };

  // ─ Render ──────────────────────────────────────────────────────────
  // All three sidebars visible as you drill down — the spec's full
  // three-level Reseller drill-down. Lower-level sidebars only render
  // once their parent is selected. The breadcrumb in the main area is
  // still the back-navigation.
  const showResellersSidebar   = true;
  const showEnterprisesSidebar = selResellerId !== null;
  const showDepartmentsSidebar = selEntId !== null;

  return (
    <div className="flex h-full min-h-0">
      {showResellersSidebar && (
      /* Sidebar 1 — resellers */
      <Sidebar
        title="Channel Partners"
        searchPlaceholder="Search channel partners…"
        width={240}
        items={resellers.map((r) => ({
          id:     r.id,
          label:  r.name,
          search: `${r.name} ${r.email ?? ""} ${r.resellerCode}`,
          _data:  r,
        }))}
        selectedId={selResellerId}
        onSelect={(it) => {
          // Click any reseller → reset enterprise + dept selections.
          setEntId(null);
          setDeptId(null);
          setEmployees([]);
          setDeptAdmin(null);
          setResellerId(it.id);
        }}
        emptyMessage={loading ? "Loading…" : (error ?? "No channel partners yet.")}
        footer={
          <button
            type="button"
            onClick={() => setAddReseller(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Add Channel Partner
          </button>
        }
        renderRow={(it) => {
          const r = (it as unknown as { _data: Reseller })._data;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {r.name}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: r.status === "active" ? "#3dcb7e" : "var(--text-muted)" }}
                />
              </div>
              <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                {r.totalEnterprises} enterprise{r.totalEnterprises === 1 ? "" : "s"} · {r.commission}% comm
              </div>
              <MinutesBar used={r.usedMinutes} allocated={r.allocatedMinutes} size="sm" />
            </div>
          );
        }}
      />
      )}

      {showEnterprisesSidebar && (
      /* Sidebar 2 — enterprises under the selected reseller */
      <Sidebar
        title="Enterprises"
        searchPlaceholder="Search enterprises…"
        width={240}
        items={(selReseller?.enterprises ?? []).map((e) => ({
          id:     e.id,
          label:  e.name,
          search: `${e.name} ${e.enterpriseCode}`,
          _data:  e,
        }))}
        selectedId={selEntId}
        onSelect={(it) => {
          setDeptId(null);
          setEmployees([]);
          setDeptAdmin(null);
          setEntId(it.id);
        }}
        emptyMessage={selReseller ? "No enterprises yet." : "Select a channel partner."}
        footer={
          selReseller && (
            <button
              type="button"
              onClick={() => setAddEnt(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              <Plus className="size-3.5" /> Add Enterprise
            </button>
          )
        }
        renderRow={(it) => {
          const e = (it as unknown as { _data: ResellerEnterprise })._data;
          // Show the org's own pool (org.allocated_minutes) — the same
          // number that appears in the Enterprise detail card. Summing
          // departments would only show what's been pushed down, hiding
          // the undistributed remainder.
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
              <MinutesBar used={e.usedMinutes} allocated={e.allocatedMinutes} size="sm" />
            </div>
          );
        }}
      />
      )}

      {showDepartmentsSidebar && (
      /* Sidebar 3 — departments under the selected enterprise */
      <Sidebar
        title="Departments"
        searchPlaceholder="Search departments…"
        width={220}
        items={(selOrg?.departments ?? []).map((d) => ({
          id:     d.id,
          label:  d.name,
          search: `${d.name} ${d.departmentCode}`,
          _data:  d,
        }))}
        selectedId={selDeptId}
        onSelect={(it) => setDeptId(it.id)}
        emptyMessage={selOrg ? "No departments yet." : "Select an enterprise."}
        footer={
          selOrg && (
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
          const d = (it as unknown as { _data: OrgDepartment })._data;
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
      )}

      {/* Main — stacked details */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={(() => {
            const crumbs: Crumb[] = [{
              label:   "Channel Partners",
              onClick: () => {
                setEntId(null);
                setDeptId(null);
                setEmployees([]);
                setDeptAdmin(null);
                setResellerId(null);
              },
            }];
            if (selReseller) {
              crumbs.push({
                label:   selReseller.name,
                onClick: () => {
                  setDeptId(null);
                  setEmployees([]);
                  setDeptAdmin(null);
                  setEntId(null);
                },
              });
            }
            if (enterpriseRow) {
              crumbs.push({
                label:   enterpriseRow.name,
                onClick: () => {
                  setDeptId(null);
                },
              });
            }
            if (selDept) {
              crumbs.push({ label: selDept.name });
            }
            return crumbs;
          })()}
        />
        {/* Mutually-exclusive views: only the deepest selected level
            renders its detail card. Parents are reachable via the
            breadcrumb above. Matches the Enterprise tab pattern. */}
        {!selReseller && (
          <EmptyState
            title="Select a channel partner"
            blurb="Pick a channel partner on the left to view their enterprises and rollups."
          />
        )}

        {selReseller && !selEntId && (
          <ResellerSummary
            reseller={selReseller}
            distributedAllocated={(orgsByReseller.get(selReseller.id) ?? [])
              .reduce((sum, o) => sum + o.departments.reduce((s, d) => s + d.allocatedMinutes, 0), 0)}
            onEdit={() => setEditReseller(true)}
            onToggle={(s) => setResellerStatus(selReseller.id, s)}
            onAddMinutes={() => setRefillTarget({
              title:      `Add minutes — ${selReseller.name}`,
              endpoint:   `/api/admin/resellers/${selReseller.id}/refill`,
              allocated:  selReseller.allocatedMinutes,
              remaining:  selReseller.remainingMinutes,
              sourceNote: "Minted to this channel partner's pool. From here they distribute minutes to their enterprises.",
            })}
          />
        )}

        {selEntId && !selDeptId && enterpriseRow && (
          <DetailCard
            title={enterpriseRow.name}
            code={enterpriseRow.enterpriseCode}
            badges={[
              {
                label: enterpriseRow.status === "active" ? "Active" : "Suspended",
                tone:  enterpriseRow.status === "active" ? "success" : "warning",
              },
            ]}
            description={enterpriseRow.primaryDomain ? `Domain: ${enterpriseRow.primaryDomain}` : undefined}
            minutes={{
              used:      enterpriseRow.usedMinutes,
              allocated: enterpriseRow.allocatedMinutes,
            }}
            rollupCaption={(() => {
              const n = selOrg?.departments.length ?? 0;
              if (n === 0) {
                return `${enterpriseRow.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} min in pool · 0 departments yet · ${enterpriseRow.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`;
              }
              const distAlloc = (selOrg?.departments ?? [])
                .reduce((s, d) => s + d.allocatedMinutes, 0);
              const remaining = Math.max(0, enterpriseRow.allocatedMinutes - distAlloc);
              return (
                `${enterpriseRow.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} allocated · ` +
                `${distAlloc.toLocaleString(undefined, { maximumFractionDigits: 2 })} distributed to ${n} department${n === 1 ? "" : "s"} · ` +
                `${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining · ` +
                `${enterpriseRow.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`
              );
            })()}
            actions={
              <DetailActions
                statusActive={enterpriseRow.status === "active"}
                onEdit={() => setEditEnt(true)}
                onAddMinutes={() => setRefillTarget({
                  title:      `Add minutes — ${enterpriseRow.name}`,
                  endpoint:   `/api/admin/orgs/${enterpriseRow.id}/refill`,
                  allocated:  enterpriseRow.allocatedMinutes,
                  remaining:  enterpriseRow.remainingMinutes,
                  sourceNote: `Drawn from ${selReseller?.name ?? "the channel partner"}'s pool — top the partner up first if it's short.`,
                })}
                onToggle={() => setOrgStatus(enterpriseRow.id, enterpriseRow.status === "active" ? "suspended" : "active")}
                onDelete={() => deleteOrg(enterpriseRow.id)}
              />
            }
          />
        )}

        {selDept && selOrg && (
          <div className="flex flex-col gap-6">
            <DetailCard
              title={selDept.name}
              code={selDept.departmentCode}
              badges={[
                {
                  label: selDept.status === "active" ? "Active" : "Suspended",
                  tone:  selDept.status === "active" ? "success" : "warning",
                },
              ]}
              minutes={{
                used:      selDept.usedMinutes,
                allocated: selDept.allocatedMinutes,
              }}
              rollupCaption={(() => {
                if (employees.length === 0) {
                  return `${selDept.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} min in pool · 0 employees yet · ${selDept.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`;
                }
                const remaining = Math.max(0, selDept.allocatedMinutes - empTotals.allocated);
                return (
                  `${selDept.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} allocated · ` +
                  `${empTotals.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} distributed to ${employees.length} employee${employees.length === 1 ? "" : "s"} · ` +
                  `${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining · ` +
                  `${selDept.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`
                );
              })()}
              actions={
                <DetailActions
                  statusActive={selDept.status === "active"}
                  onEdit={() => setEditDept(true)}
                  onToggle={() => setDeptStatus(selOrg.id, selDept.id, selDept.status === "active" ? "suspended" : "active")}
                  onDelete={() => deleteDept(selOrg.id, selDept.id)}
                />
              }
            />
            <DepartmentAdminCard
              admin={deptAdmin}
              deptActive={selDept.status === "active"}
              onResend={resendInvite}
              onToggleStatus={toggleEmployeeStatus}
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
              onToggleStatus={toggleEmployeeStatus}
              onRemove={detachEmployee}
            />
          </div>
        )}
      </main>

      <AddResellerDrawer
        open={addReseller}
        onClose={() => setAddReseller(false)}
        onCreated={(rId) => {
          setAddReseller(false);
          refresh().then(() => setResellerId(rId));
        }}
      />
      <AddEnterpriseDrawer
        open={addEnt}
        onClose={() => setAddEnt(false)}
        resellerId={selResellerId}
        resellerLabel={selReseller?.name}
        onCreated={(orgId) => {
          setAddEnt(false);
          refresh().then(() => setEntId(orgId));
        }}
      />
      <AddDepartmentDrawer
        open={addDept}
        orgId={selEntId}
        onClose={() => setAddDept(false)}
        onCreated={(deptId) => {
          setAddDept(false);
          refresh().then(() => setDeptId(deptId));
        }}
      />
      <AddEmployeeDrawer
        open={addEmp}
        orgId={selEntId}
        deptId={selDeptId}
        deptRemainingMinutes={selDept?.remainingMinutes}
        onClose={() => setAddEmp(false)}
        onCreated={() => {
          setAddEmp(false);
          refreshEmployees();
          refresh();
        }}
      />
      {selReseller && (
        <EditNameDrawer
          open={editReseller}
          title="Edit channel partner"
          label="Channel partner name"
          currentName={selReseller.name}
          endpoint={`/api/admin/resellers/${selReseller.id}`}
          onClose={() => setEditReseller(false)}
          onSaved={() => { setEditReseller(false); refresh(); }}
        />
      )}
      {enterpriseRow && (
        <EditNameDrawer
          open={editEnt}
          title="Edit enterprise"
          label="Enterprise name"
          currentName={enterpriseRow.name}
          endpoint={`/api/admin/orgs/${enterpriseRow.id}`}
          onClose={() => setEditEnt(false)}
          onSaved={() => { setEditEnt(false); refresh(); }}
        />
      )}
      {selEntId && selDept && (
        <EditNameDrawer
          open={editDept}
          title="Edit department"
          label="Department name"
          currentName={selDept.name}
          endpoint={`/api/admin/orgs/${selEntId}/departments/${selDept.id}`}
          onClose={() => setEditDept(false)}
          onSaved={() => { setEditDept(false); refresh(); }}
        />
      )}
      <AdminRefillDrawer
        target={refillTarget}
        onClose={() => setRefillTarget(null)}
        onRefilled={() => { setRefillTarget(null); refresh(); }}
      />
      <AssignAdminDrawer
        open={assignAdmin}
        orgId={selEntId}
        deptId={selDeptId}
        employees={employees.map((e) => ({ id: e.id, displayName: e.displayName, email: e.email }))}
        onClose={() => setAssignAdmin(false)}
        onAssigned={() => { setAssignAdmin(false); refreshEmployees(); refresh(); }}
      />
    </div>
  );
}

// ── Subcomponents (duplicated from EnterpriseTab so the tabs can drift) ─

function EmptyState({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-lg border border-dashed py-12 text-center" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{blurb}</p>
    </div>
  );
}

function ResellerSummary({
  reseller, distributedAllocated, onEdit, onToggle, onAddMinutes,
}: {
  reseller: Reseller;
  distributedAllocated: number;
  onEdit:   () => void;
  onToggle: (next: "active" | "suspended") => void;
  onAddMinutes: () => void;
}) {
  const badges: Badge[] = [
    {
      label: reseller.status === "active" ? "Active" : "Suspended",
      tone:  reseller.status === "active" ? "success" : "warning",
    },
    { label: `${reseller.commission}% commission`, tone: "neutral" },
  ];
  const pool = { used: reseller.usedMinutes, allocated: reseller.allocatedMinutes };
  const remaining = Math.max(0, pool.allocated - distributedAllocated);
  const caption =
    reseller.totalEnterprises === 0
      ? `${pool.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} min in pool · 0 enterprises yet · ${pool.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`
      : `${pool.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} allocated · ` +
        `${distributedAllocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} distributed to ${reseller.totalEnterprises} enterprise${reseller.totalEnterprises === 1 ? "" : "s"} · ` +
        `${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} remaining · ` +
        `${pool.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} used`;
  return (
    <DetailCard
      title={reseller.name}
      code={reseller.resellerCode}
      badges={badges}
      description={reseller.email ? `Owner: ${reseller.email}` : undefined}
      minutes={pool}
      rollupCaption={caption}
      actions={
        <>
          {reseller.status === "active" && (
            <button
              type="button"
              onClick={onAddMinutes}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              <Plus className="size-3" /> Add minutes
            </button>
          )}
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
            onClick={() => onToggle(reseller.status === "active" ? "suspended" : "active")}
            className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {reseller.status === "active" ? "Deactivate" : "Activate"}
          </button>
        </>
      }
      footerHint="Channel partners cannot be hard-deleted — only suspended. Suspending freezes the partner and blocks their login; reactivating restores them with their enterprises intact."
    />
  );
}

function DetailActions({
  statusActive, onEdit, onToggle, onDelete, onAddMinutes,
}: {
  statusActive: boolean;
  onEdit?:  () => void;
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
            DEPT ADMIN
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
  loading, error, employees, totals, onAdd, onResend, onToggleStatus, onRemove,
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
                    {e.usedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {e.allocatedMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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

function RowIcon({
  title, onClick, children, danger,
}: {
  title: string; onClick: () => void; children: React.ReactNode; danger?: boolean;
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

function initialsFor(e: Employee): string {
  const src = e.displayName || e.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}
