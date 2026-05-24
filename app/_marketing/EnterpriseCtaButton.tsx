"use client";

/*
 * Compact enterprise CTA used on dark-background sections (e.g. the
 * footer band on /for-enterprise). Renders the green "Talk to Relay
 * for Enterprise" pill button; on click swaps the button for a white/grey
 * card containing the same inquiry form as EnterpriseCta. Posts to
 * /api/contact with topic="ENTERPRISE" via lib/contact/submitContact.ts
 * (which falls back to mailto: on a 5xx so a backend outage cannot kill
 * the inquiry path).
 *
 * The card is intentionally narrow and centered so it reads as a
 * focused inquiry slot, not a hero panel.
 */

import { useRef, useState } from "react";
import { submitContact } from "../../lib/contact/submitContact";

type Status = "idle" | "submitting" | "success" | "error";

type Props = {
  /** Visible button label. Defaults to "Talk to Relay for Enterprise". */
  label?: string;
};

export function EnterpriseCtaButton({
  label = "Talk to Relay for Enterprise",
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const idPrefix = "r-cta-enterprise";
  const formId = `${idPrefix}-form`;
  const errorId = `${idPrefix}-form-error`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;

    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      company: String(data.get("company") ?? ""),
      topic: "ENTERPRISE",
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    setStatus("submitting");
    setErrorMessage(null);
    const result = await submitContact(payload);
    if (result.ok) {
      setStatus("success");
      return;
    }
    setStatus("error");
    setErrorMessage(
      result.error === "rate_limited"
        ? "Too many submissions just now — try again in a few minutes, or email hello@relay.green directly."
        : "Couldn't send. Check your name, email, and message, or write to hello@relay.green directly."
    );
  }

  function close() {
    setOpen(false);
    formRef.current?.reset();
    setStatus("idle");
    setErrorMessage(null);
  }

  function resetToForm() {
    formRef.current?.reset();
    setStatus("idle");
    setErrorMessage(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="r-btn r-btn-green r-cta-enterprise-toggle"
        aria-expanded={false}
        aria-controls={formId}
        onClick={() => setOpen(true)}
        style={{ height: 44, padding: "0 24px" }}
      >
        {label} <span className="arrow">→</span>
      </button>
    );
  }

  const submitting = status === "submitting";
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;

  return (
    <div className="r-cta-enterprise-card" id={formId}>
      <button
        type="button"
        className="r-leg-enterprise-close"
        aria-label="Close form"
        onClick={close}
      >
        <span aria-hidden="true">×</span>
      </button>

      {status === "success" ? (
        <div
          className="r-contact-success"
          role="status"
          aria-live="polite"
          style={{ textAlign: "left" }}
        >
          <h4 style={{ margin: 0, fontSize: 18 }}>Thanks, we have it.</h4>
          <p style={{ margin: "8px 0 16px" }}>
            A Relay partner will reply within one business day.
          </p>
          <button
            type="button"
            className="r-btn r-btn-ghost"
            onClick={resetToForm}
          >
            Send another message
          </button>
        </div>
      ) : (
        <form
          ref={formRef}
          className="r-contact-form r-cta-enterprise-form"
          onSubmit={onSubmit}
          noValidate
          aria-label="Enterprise inquiry"
        >
          <div aria-hidden="true" className="r-honeypot">
            <label htmlFor={`${idPrefix}-website`}>Website</label>
            <input
              id={`${idPrefix}-website`}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <div className="r-contact-row">
            <div className="r-contact-field">
              <label htmlFor={`${idPrefix}-name`}>Your name</label>
              <input
                id={`${idPrefix}-name`}
                type="text"
                name="name"
                required
                maxLength={120}
                autoComplete="name"
                disabled={submitting}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
            <div className="r-contact-field">
              <label htmlFor={`${idPrefix}-email`}>Your email</label>
              <input
                id={`${idPrefix}-email`}
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                disabled={submitting}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          </div>

          <div className="r-contact-field">
            <label htmlFor={`${idPrefix}-company`}>Company</label>
            <input
              id={`${idPrefix}-company`}
              type="text"
              name="company"
              maxLength={160}
              autoComplete="organization"
              disabled={submitting}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          </div>

          <div className="r-contact-field">
            <label htmlFor={`${idPrefix}-message`}>
              Tell us what you need
            </label>
            <textarea
              id={`${idPrefix}-message`}
              name="message"
              rows={4}
              required
              minLength={10}
              maxLength={4000}
              disabled={submitting}
              placeholder="Scale, integrations, compliance, timing. The shape of the rollout."
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
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
              {submitting ? "Sending" : "Send inquiry"}{" "}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
            <span className="r-contact-meta">
              Goes straight to a partner. One business day.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
