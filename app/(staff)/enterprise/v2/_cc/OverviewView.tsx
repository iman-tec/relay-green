"use client";

/*
 * Enterprise Overview — the command center. Primary object = Departments
 * (employees + minutes roll up per row). Slim ribbon over one Departments
 * table; row → drill-in. All states.
 */

import { useState } from "react";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import {
  StatusDot,
  type PortalStatus,
} from "@/app/_components/portal/StatusDot";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import type { EntMe, EntDepartments, EntDepartment } from "./types";

const RATE = 300; // €3.00/min synthetic spend, matches the existing reports

export function OverviewView({
  me,
  depts,
  loading,
  error,
  onRecharge,
  onOnboardDept,
}: {
  me: EntMe | null;
  depts: EntDepartments | null;
  loading: boolean;
  error: string | null;
  onRecharge: () => void;
  onOnboardDept: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
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
          {
            label: "Spend · this month",
            value: eur(me.kpis.spendMonthCents),
          },
          {
            label: "Departments",
            value: int(rows.length),
          },
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
          onClick={onOnboardDept}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white"
          style={{ background: "var(--primary)" }}
        >
          <span aria-hidden>＋</span> New department
        </button>
      </div>

      {error ? null : !depts ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <Empty onOnboardDept={onOnboardDept} />
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
        {open && <DeptDetail d={open} />}
      </DrillPanel>
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

function DeptDetail({ d }: { d: EntDepartment }) {
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
      <Field k="Spend (synthetic)" v={eur(Math.round(d.usedMinutes * RATE))} />
      <Field k="Status" v={d.status} />
    </>
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

function Empty({ onOnboardDept }: { onOnboardDept: () => void }) {
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
        onClick={onOnboardDept}
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
