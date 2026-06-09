"use client";

/*
 * Enterprise terms gate — a SINGLE blocking clickwrap at enterprise-admin entry
 * that records every acceptance the org still owes in one interaction:
 *   - the Master Services Agreement (every enterprise), and
 *   - the Channel Partner Commercial Terms (partner-onboarded orgs only, when
 *     the partner program flag is on and partner_status === 'invited').
 *
 * Previously these were two separate modals (EnterpriseMsaGate +
 * PartnerTermsGate), so a partner-onboarded admin had to click "I Agree" twice
 * on first login. This merges them: one modal, one consent, BOTH acceptances
 * recorded server-side (each endpoint still writes its own terms_acceptances row
 * with version + hash + IP; accept-terms also flips partner_status → active).
 * Self-gating: renders null unless something is actually owed. Never pre-checked;
 * terms viewable first.
 */

import { useEffect, useState } from "react";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import {
  ENTERPRISE_MSA_STATEMENT,
  ENTERPRISE_MSA_URL,
  ENTERPRISE_MSA_VERSION,
} from "@/lib/enterpriseTerms";
import {
  PARTNER_TERMS_STATEMENT,
  PARTNER_TERMS_URL,
  PARTNER_TERMS_VERSION,
} from "@/lib/billing/partnerTerms";

export function EnterpriseMsaGate() {
  const [needsMsa, setNeedsMsa] = useState(false);
  const [needsPartner, setNeedsPartner] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const msaP = fetch("/api/enterprise/accept-msa", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.needsAcceptance) setNeedsMsa(true);
      })
      .catch(() => {
        /* fail open — never hard-block on a fetch error */
      });
    const partnerP = partnerProgramEnabled()
      ? fetch("/api/enterprise/accept-terms", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!cancelled && d?.needsAcceptance) setNeedsPartner(true);
          })
          .catch(() => {})
      : Promise.resolve();
    void Promise.all([msaP, partnerP]).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || (!needsMsa && !needsPartner)) return null;

  async function accept() {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Record each owed acceptance. Mark done as we go so a partial failure
      // (e.g. partner POST fails after MSA succeeds) doesn't re-record on retry.
      if (needsMsa) {
        const res = await fetch("/api/enterprise/accept-msa", {
          method: "POST",
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Couldn't record your acceptance.");
        }
        setNeedsMsa(false);
      }
      if (needsPartner) {
        const res = await fetch("/api/enterprise/accept-terms", {
          method: "POST",
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Couldn't record your acceptance.");
        }
        setNeedsPartner(false);
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const versions = [
    needsMsa ? `MSA ${ENTERPRISE_MSA_VERSION}` : null,
    needsPartner ? `Channel Partner Terms ${PARTNER_TERMS_VERSION}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2
          id="terms-title"
          className="text-lg font-semibold"
          style={{ color: "var(--text)" }}
        >
          Accept your organization’s terms
        </h2>

        {needsMsa && (
          <div className="mt-3">
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {ENTERPRISE_MSA_STATEMENT}
            </p>
            <a
              href={ENTERPRISE_MSA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-sm font-medium underline"
              style={{ color: "var(--primary-hover)" }}
            >
              Read the Master Services Agreement
            </a>
          </div>
        )}

        {needsPartner && (
          <div
            className={needsMsa ? "mt-4 border-t pt-4" : "mt-3"}
            style={needsMsa ? { borderColor: "var(--border)" } : undefined}
          >
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {PARTNER_TERMS_STATEMENT}
            </p>
            <a
              href={PARTNER_TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-sm font-medium underline"
              style={{ color: "var(--primary-hover)" }}
            >
              Read the Channel Partner Commercial Terms
            </a>
          </div>
        )}

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
            I am authorized to accept{" "}
            {needsMsa && needsPartner ? "these terms" : "this agreement"} on
            behalf of my organization ({versions}).
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
