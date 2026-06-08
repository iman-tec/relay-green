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
import { BuyBundleModal } from "@/app/(staff)/enterprise/v2/WalletTab";
import type { EntMe, EntWallet } from "./types";

type Txn = {
  id: string;
  date: string;
  description: string;
  minutes: number;
  amountCents: number;
};

type Bundle = {
  code: string;
  label: string;
  minutes: number;
  amountCents: number;
};

export function RechargeView({
  me,
  wallet,
  onCredited,
}: {
  me: EntMe | null;
  wallet: EntWallet | null;
  onCredited: () => void;
}) {
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [buying, setBuying] = useState<Bundle | null>(null);
  // Selected recharge amount (bundle code). Defaults to best per-minute value
  // in render when unset, so one option is always pre-selected.
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/billing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (off || !d) return;
        // /api/enterprise/billing returns recentTransactions as
        // { id, occurredAt, label, durationMin, amountCents, kind } — read
        // those field names (the older date/description/minutes keys never
        // existed on the payload, which is why dates rendered as "—",
        // everything said "Session", and minutes showed 0).
        const list = (d.recentTransactions ?? []) as Array<{
          id?: string;
          occurredAt?: string;
          date?: string;
          createdAt?: string;
          label?: string;
          description?: string;
          durationMin?: number;
          minutes?: number;
          durationMinutes?: number;
          amountCents?: number;
          chargeCents?: number;
          kind?: string;
        }>;
        setTxns(
          list.map((t, i) => ({
            id: t.id ?? String(i),
            date: t.occurredAt ?? t.date ?? t.createdAt ?? "",
            description: t.label ?? t.description ?? "Session",
            minutes: Number(
              t.durationMin ?? t.minutes ?? t.durationMinutes ?? 0
            ),
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

  // Recharge selector — one amount picked, one CTA (not a Buy button per card).
  const bundles = wallet?.bundles ?? [];
  const perMinOf = (b: Bundle) => b.amountCents / b.minutes;
  const bestCode = bundles.length
    ? [...bundles].sort((a, b) => perMinOf(a) - perMinOf(b))[0].code
    : null;
  const selected =
    bundles.find((b) => b.code === selectedCode) ??
    bundles.find((b) => b.code === bestCode) ??
    bundles[0] ??
    null;

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

      {/* Recharge — pick ONE amount, then a single CTA. Buy uses the existing
          Stripe checkout (unchanged). No per-card Buy buttons. */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Buy minutes
        </h2>
        {bundles.length === 0 ? (
          <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
            No bundles available — contact your account manager.
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Recharge amount"
              className="flex flex-wrap gap-3"
            >
              {bundles.map((b) => {
                const isSel = selected?.code === b.code;
                const isBest = b.code === bestCode;
                return (
                  <button
                    key={b.code}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    onClick={() => setSelectedCode(b.code)}
                    className="relative rounded-xl border px-5 py-4 text-left transition-colors"
                    style={{
                      minWidth: 180,
                      borderColor: isSel ? "var(--primary)" : "var(--border)",
                      background: isSel ? "var(--primary-tint)" : "transparent",
                      boxShadow: isSel
                        ? "inset 0 0 0 1px var(--primary)"
                        : "none",
                    }}
                  >
                    {isBest && (
                      <span
                        className="absolute top-3 right-3 rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] uppercase"
                        style={{
                          background: "var(--primary-soft)",
                          color: "var(--primary)",
                        }}
                      >
                        Best value
                      </span>
                    )}
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
                    <div
                      className="font-mono text-[12px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {eur(Math.round(perMinOf(b)))}/min
                    </div>
                  </button>
                );
              })}
            </div>
            {selected && (
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setBuying(selected)}
                  className="rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white"
                  style={{ background: "var(--primary)" }}
                >
                  Recharge {eur(selected.amountCents)}
                </button>
                <span
                  className="text-[13px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Adds {int(selected.minutes)} minutes ·{" "}
                  {eur(Math.round(perMinOf(selected)))}/min · charged once.
                </span>
              </div>
            )}
            <p
              className="mt-3 text-[12px]"
              style={{ color: "var(--text-faint)" }}
            >
              Any partner discount is applied automatically at payment.
            </p>
          </>
        )}
      </section>

      {buying && (
        <BuyBundleModal
          bundle={buying}
          onClose={() => setBuying(null)}
          onCredited={() => {
            setBuying(null);
            onCredited();
          }}
        />
      )}

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
