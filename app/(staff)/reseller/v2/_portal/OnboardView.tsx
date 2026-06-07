"use client";

/*
 * Onboard — minimal registration (company name + admin email). The partner
 * discount auto-applies from the reseller's split server-side; no pricing step.
 * Posts to the existing POST /api/reseller/enterprises. On success, refetch the
 * portal and return to Overview, where the new company appears as 'Invited'.
 */

import { useState } from "react";
import type { PortalPayload } from "./types";

export function OnboardView({
  data,
  onDone,
}: {
  data: PortalPayload | null;
  onDone: () => void;
}) {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = company.trim().length > 1 && emailOk && !submitting;

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
          adminEmail: email.trim(),
          // Minimal flow: default the display name to the email local-part.
          adminDisplayName: adminName.trim() || email.trim().split("@")[0],
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

  const passthrough = data?.reseller.defaultPassthroughPct ?? 0;

  return (
    <div className="mx-auto max-w-[560px] px-10 py-9">
      <h1
        className="font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Onboard a company
      </h1>
      <p className="mt-1.5 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Company name and an admin email is all it takes. Your{" "}
        <strong style={{ color: "var(--text)" }}>{passthrough}%</strong>{" "}
        discount applies automatically; the admin gets a branded invite to
        accept.
      </p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
        <Field label="Company name">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Robotics"
            className="w-full rounded-md border px-3 py-2.5 text-[15px] outline-none"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--surface)",
            }}
          />
        </Field>
        <Field label="Admin email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@acme.com"
            className="w-full rounded-md border px-3 py-2.5 text-[15px] outline-none"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--surface)",
            }}
          />
        </Field>
        <Field label="Admin name (optional)">
          <input
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full rounded-md border px-3 py-2.5 text-[15px] outline-none"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--surface)",
            }}
          />
        </Field>

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
          className="mt-1 w-full rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity"
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
        className="text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
