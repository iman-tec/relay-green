"use client";

/*
 * Overview — the command center. A slim KPI ribbon (Balance due anchored) over
 * ONE Companies table; row click opens the drill-in peek. All states handled:
 * loading skeleton, error, empty (the designed first-run message).
 */

import { useEffect, useRef, useState } from "react";
import type { PortalPayload, PortalCompany } from "./types";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import { StatusDot } from "@/app/_components/portal/StatusDot";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import {
  eur,
  eurCompact,
  int,
  dateShort,
  relativeTime,
} from "@/app/_components/portal/format";

export function OverviewView({
  data,
  loading,
  error,
  onOnboard,
  onProgram,
}: {
  data: PortalPayload | null;
  loading: boolean;
  error: string | null;
  onOnboard: () => void;
  onProgram: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.companies.find((c) => c.id === openId) ?? null;

  const ribbon: Kpi[] = data
    ? [
        {
          label: "Balance due",
          value: eur(data.ribbon.balanceDueCents),
          sub: `earned ${eur(data.ribbon.earnedLifetimeCents)} · paid ${eur(data.ribbon.paidLifetimeCents)}`,
          anchor: true,
          onClick: onProgram,
        },
        {
          label: "Net spend · this month",
          value: eur(data.ribbon.spendThisMonthCents),
          sub: `${eurCompact(data.ribbon.spendLifetimeCents)} lifetime book`,
        },
        {
          label: "Minutes · this month",
          value: int(data.ribbon.minutesThisMonth),
          sub: `${int(data.ribbon.minutesLifetime)} lifetime`,
        },
        {
          label: "Active",
          value: `${data.ribbon.activeCompanies} / ${data.ribbon.totalCompanies}`,
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
          {data ? data.reseller.name : "Channel Partner"}
        </h1>
        {data && (
          <div className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {data.reseller.tier === "premier" ? "Premier" : "Partner"} ·{" "}
            {data.ribbon.totalCompanies}{" "}
            {data.ribbon.totalCompanies === 1 ? "company" : "companies"}
          </div>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : loading && !data ? (
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
          Companies
        </span>
        <button
          type="button"
          onClick={onOnboard}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-colors"
          style={{ background: "var(--primary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--primary-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--primary)")
          }
        >
          <span aria-hidden>＋</span> Onboard
        </button>
      </div>

      {error ? null : !data || (loading && !data) ? (
        <TableSkeleton />
      ) : data.companies.length === 0 ? (
        <EmptyState onOnboard={onOnboard} reseller={data.reseller} />
      ) : (
        <CompaniesTable rows={data.companies} onRow={setOpenId} />
      )}

      <DrillPanel
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.name ?? ""}
        subtitle={
          open
            ? `${open.code} · onboarded ${dateShort(open.onboardedAt)}`
            : undefined
        }
      >
        {open && <CompanyDetail c={open} />}
      </DrillPanel>
    </div>
  );
}

function CompaniesTable({
  rows,
  onRow,
}: {
  rows: PortalCompany[];
  onRow: (id: string) => void;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {[
            ["Company", "left"],
            ["Status", "left"],
            ["Min · mo", "right"],
            ["Spend · mo", "right"],
            ["Onboarded", "left"],
            ["Last activity", "left"],
          ].map(([h, align]) => (
            <th
              key={h}
              className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{
                color: "var(--text-muted)",
                textAlign: align as "left" | "right",
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
        {rows.map((c) => {
          const noData = c.partnerStatus === "invited";
          return (
            <tr
              key={c.id}
              onClick={() => onRow(c.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRow(c.id);
              }}
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
                {c.name}
              </td>
              <td className="px-4 py-3">
                {/* Account state only — Active / Invited / Paused / Suspended.
                    A null partner_status is an onboarded org (Active), NOT the
                    "Live" (in-session) signal; don't conflate the two. */}
                <StatusDot status={c.partnerStatus ?? "active"} />
              </td>
              <Num em={noData}>{noData ? "—" : int(c.minutesThisMonth)}</Num>
              <Num em={noData}>{noData ? "—" : eur(c.spendThisMonthCents)}</Num>
              <td
                className="px-4 py-3 text-[14px]"
                style={{ color: "var(--text-muted)" }}
              >
                {dateShort(c.onboardedAt)}
              </td>
              <td
                className="px-4 py-3 text-[14px]"
                style={{
                  color: noData ? "var(--text-faint)" : "var(--text-muted)",
                }}
              >
                {relativeTime(c.lastActivityAt)}
              </td>
              <RowActions c={c} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RowActions({ c }: { c: PortalCompany }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function act(path: string, ok: string) {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`/api/reseller/enterprises/${c.id}/${path}`, {
        method: "POST",
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed.");
      }
      setNote(ok);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <td
      ref={ref}
      className="relative px-2 py-3 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Actions"
        className="rounded px-1 text-[18px] opacity-0 transition-opacity group-hover/row:opacity-100"
        style={{ color: "var(--text-muted)" }}
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-2 z-50 mt-1 w-[170px] overflow-hidden rounded-lg border text-left shadow-lg"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {c.partnerStatus === "invited" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("resend-invite", "Invite re-sent")}
              className="block w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-50"
              style={{ color: "var(--text)" }}
            >
              Resend invite
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => act("nudge", "Nudge sent")}
            className="block w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-50"
            style={{ color: "var(--text)" }}
          >
            Nudge admin
          </button>
          {note && (
            <div
              className="border-t px-3 py-1.5 text-[11px]"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              {note}
            </div>
          )}
        </div>
      )}
    </td>
  );
}

function Num({ children, em }: { children: React.ReactNode; em?: boolean }) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: em ? "var(--text-faint)" : "var(--text)" }}
    >
      {children}
    </td>
  );
}

function CompanyDetail({ c }: { c: PortalCompany }) {
  return (
    <>
      <div
        className="flex gap-8 border-y py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Stat
          label="Spend · lifetime"
          value={eurCompact(c.spendLifetimeCents)}
        />
        <Stat label="Minutes · lifetime" value={int(c.minutesLifetime)} />
        <Stat
          label="You earned"
          value={eurCompact(c.earnedLifetimeCents)}
          earn
        />
      </div>
      <Field
        k="Admin"
        v={
          c.adminName || c.adminEmail
            ? c.adminName && c.adminEmail
              ? `${c.adminName} · ${c.adminEmail}`
              : c.adminName || c.adminEmail || "—"
            : "—"
        }
      />
      <Field k="Passthrough discount" v={`${c.discountPct}%`} />
      <Field
        k="This month"
        v={`${int(c.minutesThisMonth)} min · ${eur(c.spendThisMonthCents)}`}
      />
      <Field k="Last activity" v={relativeTime(c.lastActivityAt)} />
    </>
  );
}

function Stat({
  label,
  value,
  earn,
}: {
  label: string;
  value: string;
  earn?: boolean;
}) {
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
        style={{ color: earn ? "var(--primary-hover)" : "var(--text)" }}
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

function EmptyState({
  onOnboard,
  reseller,
}: {
  onOnboard: () => void;
  reseller: PortalPayload["reseller"];
}) {
  return (
    <div
      className="rounded-lg border border-dashed px-8 py-14 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>
        No companies yet.
      </p>
      <p
        className="mx-auto mt-1.5 max-w-sm text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        Onboard your first — a company name and an admin email is all it takes.
        Your {reseller.defaultPassthroughPct}% partner discount applies
        automatically.
      </p>
      <button
        type="button"
        onClick={onOnboard}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white"
        style={{ background: "var(--primary)" }}
      >
        <span aria-hidden>＋</span> Onboard a company
      </button>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border px-5 py-4 text-[14px]"
      style={{ borderColor: "var(--border)", color: "var(--risk)" }}
      role="alert"
    >
      {message}
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
      {[0, 1, 2, 3, 4].map((i) => (
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
