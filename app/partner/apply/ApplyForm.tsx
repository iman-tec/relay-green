"use client";

/*
 * The lean partner-application form (Phase 3). Six required fields + two
 * optional, a hidden honeypot, visible data-use copy, and the full state
 * machine: idle → submitting → success | error. Reuses the marketing
 * .r-contact-* form styles so it matches the contact / enterprise forms.
 *
 * Distinct from the /partner login: this captures an APPLICATION (writes a
 * partner_applications row), it is not a way in.
 */

import { useRef, useState } from "react";
import {
  submitPartnerApplication,
  type PartnerApplicationPayload,
} from "@/lib/contact/submitPartnerApplication";

type Status = "idle" | "submitting" | "success" | "error";

export function ApplyForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;

    const data = new FormData(e.currentTarget);
    const payload: PartnerApplicationPayload = {
      contactName: String(data.get("contactName") ?? ""),
      workEmail: String(data.get("workEmail") ?? ""),
      companyName: String(data.get("companyName") ?? ""),
      companyWebsite: String(data.get("companyWebsite") ?? ""),
      countryRegion: String(data.get("countryRegion") ?? ""),
      clientsText: String(data.get("clientsText") ?? ""),
      heardAbout: String(data.get("heardAbout") ?? ""),
      anythingElse: String(data.get("anythingElse") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    setStatus("submitting");
    setErrorMessage(null);
    const result = await submitPartnerApplication(payload);
    if (result.ok) {
      setStatus("success");
      return;
    }
    setStatus("error");
    setErrorMessage(
      result.error === "rate_limited"
        ? "Too many submissions just now — try again in a few minutes, or email partners@relay.green directly."
        : result.error === "invalid"
          ? "Please check the required fields — contact name, a valid work email, company, website, region, and a sentence on your clients."
          : "Couldn't submit just now. Try again in a moment, or email partners@relay.green directly."
    );
  }

  function reset() {
    formRef.current?.reset();
    setStatus("idle");
    setErrorMessage(null);
  }

  const submitting = status === "submitting";
  const errorId = "r-apply-error";
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;

  if (status === "success") {
    return (
      <div
        className="r-contact-success"
        role="status"
        aria-live="polite"
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 12,
          padding: "32px 28px",
          background: "var(--paper)",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontFamily: "var(--font-display)",
            fontSize: 24,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          Application received.
        </h3>
        <p
          style={{
            margin: "0 0 8px",
            color: "var(--ink-soft)",
            lineHeight: 1.6,
          }}
        >
          A human on our partnerships team reviews every application. We&apos;ll
          be in touch within <strong>two business days</strong>.
        </p>
        <p
          style={{
            margin: "0 0 20px",
            color: "var(--ink-soft)",
            lineHeight: 1.6,
          }}
        >
          If you&apos;re approved, that email is also your way in — it carries
          your partner sign-in invite, your reseller code, and your 20%
          wholesale pool.
        </p>
        <button type="button" className="r-btn r-btn-ghost" onClick={reset}>
          Submit another application
        </button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      id="apply"
      className="r-contact-form"
      onSubmit={onSubmit}
      noValidate
      aria-label="Partner application"
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: "28px 26px",
        background: "var(--paper)",
      }}
    >
      {/* Honeypot — hidden from real users, bots fill it → silent 200. */}
      <div aria-hidden="true" className="r-honeypot">
        <label htmlFor="r-apply-website">Website</label>
        <input
          id="r-apply-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="r-contact-row">
        <div className="r-contact-field">
          <label htmlFor="r-apply-name">Your name</label>
          <input
            id="r-apply-name"
            type="text"
            name="contactName"
            required
            maxLength={120}
            autoComplete="name"
            disabled={submitting}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        </div>
        <div className="r-contact-field">
          <label htmlFor="r-apply-email">Work email</label>
          <input
            id="r-apply-email"
            type="email"
            name="workEmail"
            required
            maxLength={254}
            autoComplete="email"
            disabled={submitting}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        </div>
      </div>

      <div className="r-contact-row">
        <div className="r-contact-field">
          <label htmlFor="r-apply-company">Company / agency</label>
          <input
            id="r-apply-company"
            type="text"
            name="companyName"
            required
            maxLength={160}
            autoComplete="organization"
            disabled={submitting}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        </div>
        <div className="r-contact-field">
          <label htmlFor="r-apply-website-url">Company website</label>
          <input
            id="r-apply-website-url"
            type="text"
            name="companyWebsite"
            required
            maxLength={200}
            autoComplete="url"
            placeholder="acme.com"
            disabled={submitting}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        </div>
      </div>

      <div className="r-contact-field">
        <label htmlFor="r-apply-region">Country / region</label>
        <input
          id="r-apply-region"
          type="text"
          name="countryRegion"
          required
          maxLength={80}
          autoComplete="country-name"
          disabled={submitting}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      </div>

      <div className="r-contact-field">
        <label htmlFor="r-apply-clients">
          Who are your clients — what do you sell today?
        </label>
        <textarea
          id="r-apply-clients"
          name="clientsText"
          rows={4}
          required
          minLength={10}
          maxLength={2000}
          disabled={submitting}
          placeholder="The kind of companies you work with, and what you build or resell for them today."
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      </div>

      <div className="r-contact-row">
        <div className="r-contact-field">
          <label htmlFor="r-apply-heard">
            How did you hear about Relay?{" "}
            <span style={{ color: "var(--ink-mute)" }}>(optional)</span>
          </label>
          <input
            id="r-apply-heard"
            type="text"
            name="heardAbout"
            maxLength={2000}
            disabled={submitting}
          />
        </div>
        <div className="r-contact-field">
          <label htmlFor="r-apply-else">
            Anything else?{" "}
            <span style={{ color: "var(--ink-mute)" }}>(optional)</span>
          </label>
          <input
            id="r-apply-else"
            type="text"
            name="anythingElse"
            maxLength={2000}
            disabled={submitting}
          />
        </div>
      </div>

      {errorMessage && (
        <div id={errorId} className="r-contact-error" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="r-contact-actions">
        <button
          type="submit"
          className="r-btn r-btn-green"
          disabled={submitting}
        >
          {submitting ? "Submitting" : "Apply to partner"}{" "}
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>

      {/* Data-use / consent copy near submit. */}
      <p
        style={{
          marginTop: 14,
          marginBottom: 0,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--ink-mute)",
        }}
      >
        We use these details only to review your application and contact you
        about the Relay partner program. No marketing list, no sharing. See our{" "}
        <a
          href="/legal/privacy-policy"
          style={{ color: "var(--green-deep)", textDecoration: "underline" }}
        >
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
