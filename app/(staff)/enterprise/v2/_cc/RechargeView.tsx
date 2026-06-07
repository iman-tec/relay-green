"use client";

/*
 * Recharge — one balance, one buy action, the partner-discount callout, and a
 * display-only unified ledger (recharges + session debits) composed from the
 * existing /api/enterprise/billing transactions. The actual Stripe checkout is
 * the existing flow (unchanged) — surfaced here, not rebuilt. Balance polls via
 * the parent hook.
 */

import { useEffect, useState } from "react";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import type { EntMe, EntWallet } from "./types";

type Txn = {
  id: string;
  date: string;
  description: string;
  minutes: number;
  amountCents: number;
};

export function RechargeView({
  me,
  wallet,
}: {
  me: EntMe | null;
  wallet: EntWallet | null;
}) {
  const [txns, setTxns] = useState<Txn[] | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/billing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (off || !d) return;
        const list = (d.recentTransactions ?? []) as Array<{
          id?: string;
          date?: string;
          createdAt?: string;
          description?: string;
          minutes?: number;
          durationMinutes?: number;
          amountCents?: number;
          chargeCents?: number;
        }>;
        setTxns(
          list.map((t, i) => ({
            id: t.id ?? String(i),
            date: t.date ?? t.createdAt ?? "",
            description: t.description ?? "Session",
            minutes: Number(t.minutes ?? t.durationMinutes ?? 0),
            amountCents: Number(t.amountCents ?? t.chargeCents ?? 0),
          }))
        );
      })
      .catch(() => setTxns([]));
    return () => {
      off = true;
    };
  }, []);

  const cp = me?.channelPartner;
  const discountActive =
    !!cp &&
    Number(me?.org.discountPct ?? 0) > 0 &&
    (!me?.org.discountUntil || new Date(me.org.discountUntil) > new Date());

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Recharge
      </h1>

      {/* Balance + discount callout */}
      <section className="mb-9">
        <div className="flex flex-wrap items-end gap-12">
          <div>
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Minutes remaining
            </div>
            <div
              className="font-mono text-[28px] font-medium tabular-nums"
              style={{ color: "var(--text)" }}
            >
              {wallet ? int(wallet.remainingMinutes) : "—"}
            </div>
          </div>
          <div>
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Distributed to depts
            </div>
            <div
              className="font-mono text-[28px] font-medium tabular-nums"
              style={{ color: "var(--text)" }}
            >
              {wallet ? int(wallet.distributedMinutes) : "—"}
            </div>
          </div>
        </div>
        {discountActive && cp && (
          <p
            className="mt-4 inline-block rounded-lg px-3 py-2 text-[13px]"
            style={{
              background: "var(--primary-tint)",
              color: "var(--primary-hover)",
            }}
          >
            Your rate includes a {me?.org.discountPct}% partner discount via{" "}
            <strong>{cp.name}</strong>
            {me?.org.discountUntil
              ? ` · through ${dateShort(me.org.discountUntil)}`
              : ""}
            .
          </p>
        )}
      </section>

      {/* Bundles — buy uses the existing Stripe checkout (unchanged) */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Buy minutes
        </h2>
        <div className="flex flex-wrap gap-4">
          {(wallet?.bundles ?? []).map((b) => (
            <div
              key={b.code}
              className="rounded-xl border px-5 py-4"
              style={{ borderColor: "var(--border)", minWidth: 180 }}
            >
              <div className="text-[15px] font-semibold">{b.label}</div>
              <div
                className="font-mono text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                {int(b.minutes)} min
              </div>
              <div className="mt-2 font-mono text-[20px] tabular-nums">
                {eur(b.amountCents)}
              </div>
              <a
                href="/enterprise/v2?tab=billing"
                className="mt-3 inline-block rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white no-underline"
                style={{ background: "var(--primary)" }}
              >
                Buy
              </a>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px]" style={{ color: "var(--text-faint)" }}>
          Checkout is the existing Stripe flow; any partner discount is applied
          automatically at payment.
        </p>
      </section>

      {/* Unified ledger (display-only) */}
      <section>
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Recent transactions
        </h2>
        {txns === null ? (
          <div
            className="h-24 rounded-lg"
            style={{ background: "var(--surface-raised)" }}
          />
        ) : txns.length === 0 ? (
          <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
            No transactions yet.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  ["Date", "left"],
                  ["Type", "left"],
                  ["Minutes", "right"],
                  ["Amount", "right"],
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
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr
                  key={t.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td
                    className="px-4 py-3 text-[14px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {dateShort(t.date)}
                  </td>
                  <td className="px-4 py-3 text-[14px]">{t.description}</td>
                  <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                    {int(t.minutes)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                    {eur(t.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[12px]" style={{ color: "var(--text-faint)" }}>
          Derived from recharges + session usage — a durable transactions ledger
          is the planned follow-up.
        </p>
      </section>
    </div>
  );
}
