"use client";

/*
 * Channel Partner clickwrap gate.
 *
 * Blocks the enterprise console with an affirmative "I Agree" the FIRST time a
 * partner-onboarded admin lands, then never again. Self-gating and inert
 * otherwise: renders null unless the partner-program flag is on AND
 * /api/enterprise/accept-terms reports the org still needs acceptance
 * (partner_status === 'invited'). For every organic / non-partner enterprise,
 * and whenever the flag is off, this is a no-op.
 *
 * Minimal, accessible scaffold — visual polish comes in the design pass. The
 * checkbox is never pre-checked; the terms are viewable (link) before consent;
 * the server records identity + time + IP + version + hash on POST.
 */

import { useEffect, useState } from "react";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import {
  PARTNER_TERMS_STATEMENT,
  PARTNER_TERMS_URL,
  PARTNER_TERMS_VERSION,
} from "@/lib/billing/partnerTerms";

export function PartnerTermsGate() {
  const [needs, setNeeds] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partnerProgramEnabled()) return;
    let cancelled = false;
    fetch("/api/enterprise/accept-terms", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.needsAcceptance) setNeeds(true);
      })
      .catch(() => {
        /* gate stays closed on error — never block the console on a fetch fail */
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
      const res = await fetch("/api/enterprise/accept-terms", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't record your acceptance.");
      }
      // Reload so the console re-fetches with partner_status === 'active'.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="partner-terms-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <h2
          id="partner-terms-title"
          className="text-lg font-semibold text-[var(--text)]"
        >
          One step before you start
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          {PARTNER_TERMS_STATEMENT}
        </p>
        <a
          href={PARTNER_TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-medium text-[var(--accent,#16a34a)] underline"
        >
          Read the full Channel Partner Commercial Terms
        </a>

        <label className="mt-4 flex items-start gap-3 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            I have read and agree to the terms above (version{" "}
            {PARTNER_TERMS_VERSION}).
          </span>
        </label>

        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={accept}
          disabled={!agreed || submitting}
          className="mt-5 w-full rounded-lg bg-[var(--accent,#16a34a)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "I Agree"}
        </button>
      </div>
    </div>
  );
}
