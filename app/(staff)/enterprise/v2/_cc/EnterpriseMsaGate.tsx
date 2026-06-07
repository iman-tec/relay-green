"use client";

/*
 * Enterprise MSA gate — blocking, affirmative clickwrap at enterprise-admin
 * entry. The signer attests authority to bind the organization. Never
 * pre-checked; terms viewable first. Self-gating: renders null unless
 * /api/enterprise/accept-msa reports the current version isn't yet accepted.
 * Distinct from the partner clickwrap (PartnerTermsGate).
 */

import { useEffect, useState } from "react";
import {
  ENTERPRISE_MSA_STATEMENT,
  ENTERPRISE_MSA_URL,
  ENTERPRISE_MSA_VERSION,
} from "@/lib/enterpriseTerms";

export function EnterpriseMsaGate() {
  const [needs, setNeeds] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/enterprise/accept-msa", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.needsAcceptance) setNeeds(true);
      })
      .catch(() => {
        /* fail open — never hard-block on a fetch error */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!needs) return null;

  async function accept() {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/enterprise/accept-msa", { method: "POST" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Couldn't record your acceptance.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="msa-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2
          id="msa-title"
          className="text-lg font-semibold"
          style={{ color: "var(--text)" }}
        >
          Accept your organization’s terms
        </h2>
        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {ENTERPRISE_MSA_STATEMENT}
        </p>
        <a
          href={ENTERPRISE_MSA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-medium underline"
          style={{ color: "var(--primary-hover)" }}
        >
          Read the full Master Services Agreement
        </a>

        <label
          className="mt-4 flex items-start gap-3 text-sm"
          style={{ color: "var(--text)" }}
        >
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            I am authorized to accept on behalf of my organization (version{" "}
            {ENTERPRISE_MSA_VERSION}).
          </span>
        </label>

        {error && (
          <p
            className="mt-3 text-sm"
            style={{ color: "var(--risk)" }}
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={accept}
          disabled={!agreed || submitting}
          className="mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--primary)" }}
        >
          {submitting ? "Saving…" : "I Agree"}
        </button>
      </div>
    </div>
  );
}
