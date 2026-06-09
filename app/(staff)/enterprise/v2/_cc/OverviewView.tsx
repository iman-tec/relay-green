"use client";

/*
 * Enterprise Overview — the command center. Primary object = Departments
 * (employees + minutes roll up per row). Slim ribbon over one Departments
 * table; row → drill-in (with in-place refill). Create-department happens in a
 * modal here — no jump to the legacy console. All states.
 */

import { useState } from "react";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import {
  StatusDot,
  type PortalStatus,
} from "@/app/_components/portal/StatusDot";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import {
  Modal,
  ModalField,
  modalInputClass,
  modalInputStyle,
} from "@/app/_components/portal/Modal";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import type { EntMe, EntDepartments, EntDepartment } from "./types";

const RATE = 300; // €3.00/min synthetic spend, matches the existing reports

export function OverviewView({
  me,
  depts,
  loading,
  error,
  onRecharge,
  onChanged,
}: {
  me: EntMe | null;
  depts: EntDepartments | null;
  loading: boolean;
  error: string | null;
  onRecharge: () => void;
  onChanged: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = depts?.departments ?? [];
  const open = rows.find((d) => d.id === openId) ?? null;

  const ribbon: Kpi[] =
    me && depts
      ? [
          {
            label: "Minutes remaining",
            value: int(depts.enterprise.remainingMinutes),
            sub: `${int(depts.departments.reduce((a, d) => a + d.allocatedMinutes, 0))} distributed to depts`,
            anchor: true,
            onClick: onRecharge,
          },
          { label: "Spend · this month", value: eur(me.kpis.spendMonthCents) },
          { label: "Departments", value: int(rows.length) },
          {
            label: "People",
            value: int(me.kpis.userCount),
            sub: `${int(me.kpis.liveNow)} live now`,
          },
        ]
      : [];

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <div className="mb-7 flex items-baseline justify-between">
        <h1
          className="font-serif text-[22px] font-semibold"
          style={{ letterSpacing: "-0.01em" }}
        >
          {me?.org.name ?? "Enterprise"}
        </h1>
        {me && (
          <div className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            <span className="font-mono">{me.org.enterpriseCode}</span> ·{" "}
            {rows.length} {rows.length === 1 ? "department" : "departments"}
          </div>
        )}
      </div>

      {error ? (
        <Err msg={error} />
      ) : loading && !me ? (
        <RibbonSkeleton />
      ) : (
        <div className="mb-9">
          <KpiRibbon items={ribbon} />
        </div>
      )}

      <div className="mb-2.5 flex items-center justify-between">
        <span
          className="text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Departments
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white"
          style={{ background: "var(--primary)" }}
        >
          <span aria-hidden>＋</span> New department
        </button>
      </div>

      {error ? null : !depts ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <Empty onCreate={() => setCreating(true)} />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                ["Department", "left"],
                ["Status", "left"],
                ["People", "right"],
                ["Min used", "right"],
                ["Min left", "right"],
                ["Spend", "right"],
              ].map(([h, a]) => (
                <th
                  key={h}
                  className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
                  style={{
                    color: "var(--text-muted)",
                    textAlign: a as "left" | "right",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
              <th
                style={{ borderBottom: "1px solid var(--border)", width: 24 }}
                aria-hidden
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                onClick={() => setOpenId(d.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setOpenId(d.id)}
                className="group/row cursor-pointer outline-none"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-raised)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <td
                  className="px-4 py-3 text-[14px] font-medium"
                  style={{ color: "var(--text)" }}
                >
                  {d.name}
                </td>
                <td className="px-4 py-3">
                  <StatusDot status={d.status as PortalStatus} />
                </td>
                <Num>
                  {int(d.activeEmployees)}
                  <span style={{ color: "var(--text-faint)" }}>
                    /{int(d.totalEmployees)}
                  </span>
                </Num>
                <Num>{int(d.usedMinutes)}</Num>
                <Num>{int(d.remainingMinutes)}</Num>
                <Num>{eur(Math.round(d.usedMinutes * RATE))}</Num>
                <td
                  className="px-2 py-3 text-right text-[18px] opacity-0 transition-opacity group-hover/row:opacity-100"
                  style={{ color: "var(--text-faint)" }}
                  aria-hidden
                >
                  ⋯
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DrillPanel
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.name ?? ""}
        subtitle={
          open
            ? `${open.departmentCode} · created ${dateShort(open.createdAt)}`
            : undefined
        }
      >
        {open && (
          <DeptDetail
            d={open}
            orgRemaining={depts?.enterprise.remainingMinutes ?? 0}
            onRefilled={() => {
              onChanged();
              setOpenId(null);
            }}
          />
        )}
      </DrillPanel>

      <CreateDeptModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          onChanged();
        }}
      />
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: "var(--text)" }}
    >
      {children}
    </td>
  );
}

function DeptDetail({
  d,
  orgRemaining,
  onRefilled,
}: {
  d: EntDepartment;
  orgRemaining: number;
  onRefilled: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amt = Number(amount);
  const canRefill = amt > 0 && amt <= orgRemaining && !busy;

  // Add-employee (invite new) — POSTs to the existing departments/[id]/employees
  // endpoint, which invites the user, links them to this department, and
  // transfers the initial minutes from the DEPARTMENT pool (≤ its remaining).
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empMinutes, setEmpMinutes] = useState("");
  const [empBusy, setEmpBusy] = useState(false);
  const [empErr, setEmpErr] = useState<string | null>(null);
  const empEmailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(empEmail.trim());
  const empAlloc = empMinutes.trim() ? Number(empMinutes) : 0;
  const canAddEmp =
    empName.trim().length > 0 &&
    empEmailOk &&
    empAlloc >= 0 &&
    empAlloc <= d.remainingMinutes &&
    !empBusy;

  // Add-existing — attach an existing Relay user (by email) into this dept,
  // no fresh invite. POSTs to departments/[id]/employees/attach.
  const [attachEmail, setAttachEmail] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const attachOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(attachEmail.trim());

  // Suspend / reactivate the whole department. Suspend cascades server-side
  // (members' minutes return to the pool, every dept user is banned); reactivate
  // cascades the unban back. Reversible.
  const suspended = d.status === "suspended";
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  async function setDeptStatus(next: "active" | "suspended") {
    if (statusBusy) return;
    setStatusBusy(true);
    setStatusErr(null);
    try {
      const r = await fetch(`/api/enterprise/departments/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't update the department.");
      }
      onRefilled();
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : "Couldn't update.");
      setStatusBusy(false);
    }
  }

  async function attachExisting() {
    if (!attachOk || attachBusy) return;
    setAttachBusy(true);
    setAttachErr(null);
    try {
      const r = await fetch(
        `/api/enterprise/departments/${d.id}/employees/attach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: attachEmail.trim() }),
        }
      );
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't add user.");
      }
      setAttachEmail("");
      onRefilled();
    } catch (e) {
      setAttachErr(e instanceof Error ? e.message : "Couldn't add user.");
      setAttachBusy(false);
    }
  }

  async function addEmployee() {
    if (!canAddEmp) return;
    setEmpBusy(true);
    setEmpErr(null);
    try {
      const r = await fetch(`/api/enterprise/departments/${d.id}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: empName.trim(),
          email: empEmail.trim(),
          allocatedMinutes: empAlloc,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't add employee.");
      }
      setEmpName("");
      setEmpEmail("");
      setEmpMinutes("");
      onRefilled();
    } catch (e) {
      setEmpErr(e instanceof Error ? e.message : "Couldn't add employee.");
      setEmpBusy(false);
    }
  }

  async function refill() {
    if (!canRefill) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/enterprise/departments/${d.id}/refill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Refill failed.");
      }
      onRefilled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refill failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="flex gap-8 border-y py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Stat label="Allocated" value={int(d.allocatedMinutes)} />
        <Stat label="Used" value={int(d.usedMinutes)} />
        <Stat label="Remaining" value={int(d.remainingMinutes)} />
      </div>
      <Field
        k="People"
        v={`${int(d.activeEmployees)} active / ${int(d.totalEmployees)}`}
      />
      <Field k="Spend" v={eur(Math.round(d.usedMinutes * RATE))} />
      <Field k="Status" v={suspended ? "Suspended" : "Active"} />

      {/* Suspend / reactivate the department */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setDeptStatus(suspended ? "active" : "suspended")}
          disabled={statusBusy}
          className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-50"
          style={{
            borderColor: suspended ? "var(--primary)" : "var(--risk)",
            color: suspended ? "var(--primary-hover)" : "var(--risk)",
          }}
        >
          {statusBusy
            ? "…"
            : suspended
              ? "Reactivate department"
              : "Suspend department"}
        </button>
        {statusErr && (
          <span className="text-[13px]" style={{ color: "var(--risk)" }}>
            {statusErr}
          </span>
        )}
      </div>
      {suspended && (
        <p className="mt-3 text-[12px]" style={{ color: "var(--text-faint)" }}>
          Suspended — members can’t sign in and their minutes were returned to
          the org pool. Reactivate to restore access (minutes aren’t
          auto-restored — refill as needed).
        </p>
      )}

      {!suspended && (
        <>
          <div className="mt-5">
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Refill from org pool ({int(orgRemaining)} available)
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Minutes"
                className="w-32 rounded-md border px-3 py-2 text-[14px] outline-none"
                style={modalInputStyle}
              />
              <button
                type="button"
                onClick={refill}
                disabled={!canRefill}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
                style={{
                  background: "var(--primary)",
                  opacity: canRefill ? 1 : 0.5,
                  cursor: canRefill ? "pointer" : "not-allowed",
                }}
              >
                {busy ? "Adding…" : "Refill"}
              </button>
            </div>
            {err && (
              <p className="mt-2 text-[13px]" style={{ color: "var(--risk)" }}>
                {err}
              </p>
            )}
          </div>

          {/* Add employee (invite new) — assigns into this department. */}
          <div
            className="mt-6 border-t pt-5"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Add employee
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder="Full name"
                className="rounded-md border px-3 py-2 text-[14px] outline-none"
                style={modalInputStyle}
              />
              <input
                type="email"
                value={empEmail}
                onChange={(e) => setEmpEmail(e.target.value)}
                placeholder="name@company.com"
                className="rounded-md border px-3 py-2 text-[14px] outline-none"
                style={modalInputStyle}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={d.remainingMinutes}
                  value={empMinutes}
                  onChange={(e) => setEmpMinutes(e.target.value)}
                  placeholder="Initial minutes (optional)"
                  className="w-56 rounded-md border px-3 py-2 text-[14px] outline-none"
                  style={modalInputStyle}
                />
                <button
                  type="button"
                  onClick={addEmployee}
                  disabled={!canAddEmp}
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
                  style={{
                    background: "var(--primary)",
                    opacity: canAddEmp ? 1 : 0.5,
                    cursor: canAddEmp ? "pointer" : "not-allowed",
                  }}
                >
                  {empBusy ? "Adding…" : "Add & invite"}
                </button>
              </div>
            </div>
            <p
              className="mt-1.5 text-[12px]"
              style={{ color: "var(--text-faint)" }}
            >
              Minutes draw from this department’s pool (
              {int(d.remainingMinutes)} available). They’re emailed an invite to
              join.
            </p>
            {empErr && (
              <p className="mt-2 text-[13px]" style={{ color: "var(--risk)" }}>
                {empErr}
              </p>
            )}
          </div>

          {/* Add an existing user (no invite). */}
          <div
            className="mt-5 border-t pt-5"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Add existing user
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={attachEmail}
                onChange={(e) => setAttachEmail(e.target.value)}
                placeholder="existing@company.com"
                className="w-64 rounded-md border px-3 py-2 text-[14px] outline-none"
                style={modalInputStyle}
              />
              <button
                type="button"
                onClick={attachExisting}
                disabled={!attachOk || attachBusy}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-50"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              >
                {attachBusy ? "Adding…" : "Add to department"}
              </button>
            </div>
            <p
              className="mt-1.5 text-[12px]"
              style={{ color: "var(--text-faint)" }}
            >
              For someone who already has a Relay account — no new invite.
              Refill their minutes after.
            </p>
            {attachErr && (
              <p className="mt-2 text-[13px]" style={{ color: "var(--risk)" }}>
                {attachErr}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}

function CreateDeptModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = name.trim().length > 1 && emailOk && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/enterprise/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          adminEmail: email.trim(),
          adminDisplayName: adminName.trim() || email.trim().split("@")[0],
          allocatedMinutes: Number(minutes) || 0,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't create the department.");
      }
      setName("");
      setEmail("");
      setAdminName("");
      setMinutes("");
      onCreated();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New department">
      <form onSubmit={submit}>
        <ModalField label="Department name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        <ModalField label="Admin email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lead@acme.com"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        <ModalField label="Admin name (optional)">
          <input
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Jane Doe"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        <ModalField label="Allocate minutes (optional)">
          <input
            type="number"
            min={0}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="0"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        {err && (
          <p className="mb-3 text-[13px]" style={{ color: "var(--risk)" }}>
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity"
          style={{
            background: "var(--primary)",
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Creating…" : "Create + invite admin"}
        </button>
      </form>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mb-1.5 text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[19px] tabular-nums"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex items-center justify-between border-b py-4"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        {k}
      </span>
      <span className="text-[14px] font-medium">{v}</span>
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="rounded-lg border border-dashed px-8 py-14 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>
        No departments yet.
      </p>
      <p
        className="mx-auto mt-1.5 max-w-sm text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        Create your first department to allocate minutes and onboard employees.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white"
        style={{ background: "var(--primary)" }}
      >
        <span aria-hidden>＋</span> New department
      </button>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div
      className="rounded-lg border px-5 py-4 text-[14px]"
      style={{ borderColor: "var(--border)", color: "var(--risk)" }}
      role="alert"
    >
      {msg}
    </div>
  );
}

function RibbonSkeleton() {
  return (
    <div className="mb-9 flex gap-14">
      {[0, 1, 2, 3].map((i) => (
        <div key={i}>
          <div
            className="mb-2 h-3 w-20 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
          <div
            className="h-7 w-28 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[45px] border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-3 h-4 w-40 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}
