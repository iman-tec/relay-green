"use client";

/*
 * Onboard — provision a company AND configure its deal in one screen:
 *   - identity: company name, admin email + name, optional primary domain
 *   - the deal: passthrough discount % (the cut of YOUR wholesale rate you give
 *     the client) + how long it lasts (months → discount_until)
 * The summary makes the economics legible (client price vs your margin) before
 * you send. Posts to the existing POST /api/reseller/enterprises, which guards
 * passthrough ≤ your wholesale rate and persists discount_pct + discount_until.
 * On success, refetch the portal and return to Overview ('Invited').
 */

import { useState } from "react";
import { eur } from "@/app/_components/portal/format";
import type { PortalPayload } from "./types";

const LIST_CENTS_PER_MIN = 300; // €3.00/min list — mirrors lib/billing.

function monthsOut(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OnboardView({
  data,
  onDone,
}: {
  data: PortalPayload | null;
  onDone: () => void;
}) {
  const wholesale = data?.reseller.commission ?? 0; // your max passthrough
  const defaultPass = data?.reseller.defaultPassthroughPct ?? 0;

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [domain, setDomain] = useState("");
  const [passthrough, setPassthrough] = useState<number>(defaultPass);
  const [months, setMonths] = useState<number>(12);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const passOk = passthrough >= 0 && passthrough <= wholesale;
  const canSubmit =
    company.trim().length > 1 && emailOk && passOk && !submitting;

  // Economics preview.
  const clientPerMin = Math.round(LIST_CENTS_PER_MIN * (1 - passthrough / 100));
  const marginPct = Math.max(0, wholesale - passthrough); // your net cut

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/reseller/enterprises", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: company.trim(),
          primaryDomain: domain.trim() || undefined,
          adminEmail: email.trim(),
          adminDisplayName: adminName.trim() || email.trim().split("@")[0],
          discountPct: passthrough,
          discountMonths: months,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't onboard the company.");
      }
      setDone(true);
      setTimeout(onDone, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[620px] px-10 py-9">
      <h1
        className="font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Onboard a company
      </h1>
      <p className="mt-1.5 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Provision the company and set its deal. The admin gets a branded invite
        to accept; the discount applies automatically at their checkout.
      </p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-5">
        {/* Identity */}
        <Section title="Company">
          <Field label="Company name">
            <Input
              value={company}
              onChange={setCompany}
              placeholder="Acme Robotics"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Admin email">
              <Input
                value={email}
                onChange={setEmail}
                placeholder="admin@acme.com"
                type="email"
              />
            </Field>
            <Field label="Admin name (optional)">
              <Input
                value={adminName}
                onChange={setAdminName}
                placeholder="Jane Doe"
              />
            </Field>
          </div>
          <Field label="Primary domain (optional)">
            <Input value={domain} onChange={setDomain} placeholder="acme.com" />
          </Field>
        </Section>

        {/* The deal */}
        <Section title="The deal">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Passthrough discount (max ${wholesale}%)`}>
              <div className="flex items-center gap-1.5">
                <Input
                  value={String(passthrough)}
                  onChange={(v) => setPassthrough(Number(v) || 0)}
                  type="number"
                  min={0}
                  max={wholesale}
                />
                <span style={{ color: "var(--text-muted)" }}>%</span>
              </div>
            </Field>
            <Field label="For how long">
              <div className="flex items-center gap-1.5">
                <Input
                  value={String(months)}
                  onChange={(v) => setMonths(Math.max(0, Number(v) || 0))}
                  type="number"
                  min={0}
                  max={60}
                />
                <span style={{ color: "var(--text-muted)" }}>months</span>
              </div>
            </Field>
          </div>
          {!passOk && (
            <p className="text-[13px]" style={{ color: "var(--risk)" }}>
              Passthrough can’t exceed your wholesale rate ({wholesale}%).
            </p>
          )}
        </Section>

        {/* Economics preview — makes the deal legible before sending. */}
        <div
          className="rounded-xl border p-4 text-[13px]"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-raised)",
          }}
        >
          <div className="flex items-center justify-between py-1">
            <span style={{ color: "var(--text-muted)" }}>Client pays</span>
            <span className="font-mono tabular-nums">
              {eur(clientPerMin)}/min{" "}
              <span style={{ color: "var(--text-faint)" }}>
                (list {eur(LIST_CENTS_PER_MIN)})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span style={{ color: "var(--text-muted)" }}>You earn</span>
            <span className="font-mono tabular-nums">
              {marginPct}% margin{" "}
              <span style={{ color: "var(--text-faint)" }}>
                ({wholesale}% wholesale − {passthrough}% passthrough)
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span style={{ color: "var(--text-muted)" }}>Discount window</span>
            <span>
              {months > 0 ? (
                <>
                  {months} months ·{" "}
                  <strong style={{ color: "var(--text)" }}>
                    through {monthsOut(months)}
                  </strong>
                </>
              ) : (
                "Indefinite"
              )}
            </span>
          </div>
          <p
            className="mt-2 border-t pt-2 text-[12px]"
            style={{ color: "var(--text-faint)", borderColor: "var(--border)" }}
          >
            On first sign-in the admin accepts the organization’s MSA; their
            departments + members are bound to it.
          </p>
        </div>

        {error && (
          <p
            className="text-[13px]"
            style={{ color: "var(--risk)" }}
            role="alert"
          >
            {error}
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
          {done ? "Invited ✓" : submitting ? "Onboarding…" : "Send invite"}
        </button>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[12px] font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      min={min}
      max={max}
      className="w-full rounded-md border px-3 py-2.5 text-[15px] outline-none"
      style={{
        borderColor: "var(--border-strong)",
        background: "var(--surface)",
      }}
    />
  );
}
