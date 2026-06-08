"use client";

/*
 * Individual referrals — the partner's standalone-individual commission ledger,
 * deliberately SEPARATE from the enterprise companies table and from enterprise
 * passthrough margin. Lists individuals who signed up via the partner's ?ref
 * link: when referred, status, their discount, and the partner's accrued
 * commission (from the dated referral_commission_entries ledger). No individual
 * PII — the endpoint returns opaque handles only.
 */

import { useEffect, useState } from "react";
import { eur } from "@/app/_components/portal/format";

type Referral = {
  id: string;
  handle: string;
  status: string;
  discountPct: number;
  commissionPct: number;
  referredAt: string;
  accruedCommissionCents: number;
  lastAccrualAt: string | null;
};

type Payload = {
  referrals: Referral[];
  totals: { count: number; active: number; accruedCommissionCents: number };
};

function dateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  converted: "Joined a company",
  churned: "Inactive",
};

export function IndividualReferralsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/reseller/individual-referrals", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !off && setData(d as Payload))
      .catch(() => !off && setError(true));
    return () => {
      off = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <div className="mb-2 flex items-baseline justify-between">
        <h1
          className="font-serif text-[22px] font-semibold"
          style={{ letterSpacing: "-0.01em" }}
        >
          Individual referrals
        </h1>
      </div>
      <p className="mb-7 max-w-[640px] text-[13px]" style={{ color: "var(--text-muted)" }}>
        Standalone individuals who signed up through your referral link — separate
        from the companies you onboard. They get a discount; you earn commission
        on what they spend, tracked here.
      </p>

      {error ? (
        <Muted>Couldn&apos;t load referrals. Try again shortly.</Muted>
      ) : data === null ? (
        <Skeleton />
      ) : data.referrals.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Ribbon totals={data.totals} />
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  ["Individual", "left"],
                  ["Referred", "left"],
                  ["Status", "left"],
                  ["Discount", "right"],
                  ["Commission", "right"],
                  ["Accrued", "right"],
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
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td
                    className="px-4 py-3 font-mono text-[13px]"
                    style={{ color: "var(--text)" }}
                  >
                    {r.handle}
                  </td>
                  <td
                    className="px-4 py-3 text-[14px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {dateShort(r.referredAt)}
                  </td>
                  <td
                    className="px-4 py-3 text-[14px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </td>
                  <Num muted>{r.discountPct}%</Num>
                  <Num muted>{r.commissionPct}%</Num>
                  <Num>{eur(r.accruedCommissionCents)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Ribbon({
  totals,
}: {
  totals: Payload["totals"];
}) {
  const items: [string, string][] = [
    ["Referred", String(totals.count)],
    ["Active", String(totals.active)],
    ["Commission accrued", eur(totals.accruedCommissionCents)],
  ];
  return (
    <div className="mb-8 flex gap-14">
      {items.map(([label, value]) => (
        <div key={label}>
          <div
            className="mb-1 text-[12px] font-medium tracking-[0.04em] uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            {label}
          </div>
          <div
            className="font-mono text-[22px] tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Num({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: muted ? "var(--text-muted)" : "var(--text)" }}
    >
      {children}
    </td>
  );
}

function Empty() {
  return (
    <div
      className="rounded-lg border border-dashed px-8 py-14 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>
        No individual referrals yet
      </p>
      <p
        className="mx-auto mt-1.5 max-w-md text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        Share your referral link from the{" "}
        <span style={{ color: "var(--text)" }}>Resources</span> tab. Individuals
        who sign up through it get a discount automatically, and your commission
        accrues here — dated and traceable.
      </p>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

function Skeleton() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[49px] border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-3.5 h-4 w-44 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}
