"use client";

/*
 * Program — the 2-tier status (Partner / Premier) gated on a single transparent
 * metric (monthly book spend), with a progress nudge and the downloadable
 * "Relay Certified Partner" badge (SVG + PNG). Also surfaces the payout ledger
 * summary (earned / paid / balance) since the Balance-due ribbon anchor links
 * here.
 */

import type { PortalPayload } from "./types";
import { eur } from "./format";
import {
  TIER_LABEL,
  tierFromMonthlyBookCents,
  centsToPremier,
  premierProgress,
} from "@/lib/billing/partnerTiers";
import { buildBadgeSvg, downloadSvg, downloadPng } from "./badge";

export function ProgramView({ data }: { data: PortalPayload | null }) {
  if (!data) return <Shell>Loading…</Shell>;

  const book = data.ribbon.spendThisMonthCents;
  const tier = tierFromMonthlyBookCents(book);
  const toGo = centsToPremier(book);
  const progress = premierProgress(book);
  const year = new Date().getFullYear();
  const svg = buildBadgeSvg({ tier, year, org: data.reseller.name });
  const file = `relay-certified-${tier}-${year}`;

  return (
    <Shell>
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Program
      </h1>

      {/* Tier + progress */}
      <section className="mb-10">
        <div className="flex items-baseline gap-3">
          <span
            className="font-serif text-[28px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            {TIER_LABEL[tier]}
          </span>
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {data.reseller.commission}% wholesale ·{" "}
            {data.reseller.defaultPassthroughPct}% default passthrough
          </span>
        </div>

        {tier === "premier" ? (
          <p
            className="mt-3 text-[14px]"
            style={{ color: "var(--text-muted)" }}
          >
            You’re at the top tier. {eur(book)} of book this month.
          </p>
        ) : (
          <div className="mt-4 max-w-md">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--surface-raised)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  background: "var(--primary)",
                }}
              />
            </div>
            <p
              className="mt-2.5 text-[14px]"
              style={{ color: "var(--text-muted)" }}
            >
              <span style={{ color: "var(--text)", fontWeight: 500 }}>
                {eur(toGo)}
              </span>{" "}
              more book this month to reach Premier.
            </p>
          </div>
        )}
      </section>

      {/* Payout ledger */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Payouts
        </h2>
        <div className="flex gap-12">
          <Led label="Earned" value={eur(data.ribbon.earnedLifetimeCents)} />
          <Led label="Paid out" value={eur(data.ribbon.paidLifetimeCents)} />
          <Led
            label="Balance due"
            value={eur(data.ribbon.balanceDueCents)}
            anchor
          />
        </div>
      </section>

      {/* Badge */}
      <section>
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Partner badge
        </h2>
        <div className="flex flex-wrap items-end gap-6">
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: "var(--border)", width: 320 }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="flex flex-col gap-2.5">
            <p
              className="max-w-xs text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              Show it on LinkedIn or your site. Regenerates with your current
              tier.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => downloadSvg(svg, `${file}.svg`)}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-medium"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => downloadPng(svg, `${file}.png`)}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-medium"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              >
                Download PNG
              </button>
            </div>
          </div>
        </div>
      </section>
    </Shell>
  );
}

function Led({
  label,
  value,
  anchor,
}: {
  label: string;
  value: string;
  anchor?: boolean;
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
        className="font-mono text-[24px] tabular-nums"
        style={{ color: "var(--text)" }}
      >
        <span
          className="inline-block pb-1"
          style={
            anchor
              ? { boxShadow: "inset 0 -2px 0 0 var(--primary)" }
              : undefined
          }
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1080px] px-10 py-9">{children}</div>;
}
