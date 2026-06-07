"use client";

/*
 * Department Overview — primary object = Employees. Slim ribbon (dept minutes +
 * spend, read-only) over one Employees table; row → drill-in. Dept admins do
 * NOT recharge — spend is read-only; budgets are a deferred flag.
 */

import { useState } from "react";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import {
  StatusDot,
  type PortalStatus,
} from "@/app/_components/portal/StatusDot";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import type { DeptData, DeptEmployee } from "./types";

const RATE = 300;

export function OverviewView({
  data,
  loading,
  error,
}: {
  data: DeptData | null;
  loading: boolean;
  error: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = data?.employees ?? [];
  const open = rows.find((e) => e.id === openId) ?? null;
  const dept = data?.department;
  const active = rows.filter(
    (e) => e.status?.toLowerCase() === "active"
  ).length;

  const ribbon: Kpi[] = dept
    ? [
        {
          label: "Minutes remaining",
          value: int(dept.remainingMinutes),
          sub: `${int(dept.allocatedMinutes)} allocated`,
          anchor: true,
        },
        {
          label: "Spend · to date",
          value: eur(Math.round(dept.usedMinutes * RATE)),
        },
        { label: "Employees", value: int(rows.length) },
        { label: "Active", value: `${active} / ${rows.length}` },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <div className="mb-7 flex items-baseline justify-between">
        <h1
          className="font-serif text-[22px] font-semibold"
          style={{ letterSpacing: "-0.01em" }}
        >
          {dept?.name ?? "Department"}
        </h1>
        {data && (
          <div className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {data.enterprise.name} ·{" "}
            <span className="font-mono">{dept?.departmentCode}</span>
          </div>
        )}
      </div>

      {error ? (
        <Err msg={error} />
      ) : loading && !data ? (
        <RibbonSkeleton />
      ) : (
        <div className="mb-9">
          <KpiRibbon items={ribbon} />
        </div>
      )}

      <div className="mb-2.5">
        <span
          className="text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Employees
        </span>
      </div>

      {error ? null : !data ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                ["Name", "left"],
                ["Status", "left"],
                ["Min used", "right"],
                ["Min left", "right"],
                ["Spend", "right"],
                ["Joined", "left"],
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
            {rows.map((e) => (
              <tr
                key={e.id}
                onClick={() => setOpenId(e.id)}
                tabIndex={0}
                onKeyDown={(ev) => ev.key === "Enter" && setOpenId(e.id)}
                className="group/row cursor-pointer outline-none"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(ev) =>
                  (ev.currentTarget.style.background = "var(--surface-raised)")
                }
                onMouseLeave={(ev) =>
                  (ev.currentTarget.style.background = "transparent")
                }
              >
                <td
                  className="px-4 py-3 text-[14px] font-medium"
                  style={{ color: "var(--text)" }}
                >
                  {e.displayName || e.email || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusDot status={e.status?.toLowerCase() as PortalStatus} />
                </td>
                <Num>{int(e.usedMinutes)}</Num>
                <Num>{int(e.remainingMinutes)}</Num>
                <Num>{eur(Math.round(e.usedMinutes * RATE))}</Num>
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {dateShort(e.createdAt)}
                </td>
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
        title={open?.displayName || open?.email || ""}
        subtitle={open ? `joined ${dateShort(open.createdAt)}` : undefined}
      >
        {open && <EmpDetail e={open} />}
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

function EmpDetail({ e }: { e: DeptEmployee }) {
  return (
    <>
      <div
        className="flex gap-8 border-y py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Stat label="Allocated" value={int(e.allocatedMinutes)} />
        <Stat label="Used" value={int(e.usedMinutes)} />
        <Stat label="Remaining" value={int(e.remainingMinutes)} />
      </div>
      <Field k="Email" v={e.email || "—"} />
      <Field k="Spend (synthetic)" v={eur(Math.round(e.usedMinutes * RATE))} />
      <Field k="Status" v={e.status} />
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

function Empty() {
  return (
    <div
      className="rounded-lg border border-dashed px-8 py-14 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>
        No employees yet.
      </p>
      <p
        className="mx-auto mt-1.5 max-w-sm text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        Your enterprise admin can invite employees into this department.
      </p>
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
      {[0, 1, 2].map((i) => (
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
