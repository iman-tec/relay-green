"use client";

/*
 * Per-card "Get in touch" disclosure used inside each .r-leg phase card
 * on the marketing home (Build / Launch / Maintain). Mirrors the
 * EnterpriseCta behavior: the bottom CTA reveals an inline contact form
 * in place instead of navigating to /company/contact. Submissions POST
 * to /api/contact via lib/contact/submitContact.ts with the card's topic
 * (BUILD / LAUNCH / MAINTAIN). Helper falls back to mailto: on 5xx so
 * the inquiry path survives a backend outage.
 *
 * Input IDs are prefixed with the topic so multiple cards with their
 * forms open simultaneously don't produce duplicate-id collisions.
 */

import { useRef, useState } from "react";
import { submitContact } from "../../lib/contact/submitContact";

type Status = "idle" | "submitting" | "success" | "error";

type Props = {
  /** Uppercase topic value matching the /api/contact enum (BUILD, LAUNCH, MAINTAIN). */
  topic: string;
  /**
   * Optional controlled-open. Provide both `open` and `onOpenChange` to let a
   * parent open the form programmatically (used by the clickable tier rows in
   * Home.tsx). Omit both for the default uncontrolled behavior.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional pre-fill. When a quoted tier row is clicked, the parent passes
   * the selected plan so the message field opens with "I'd like to discuss:
   * <name> (<price>)" already typed. The client can edit before sending.
   */
  selectedPlan?: { name: string; priceLabel: string } | null;
};

export function PhaseCtaForm({
  topic,
  open: openProp,
  onOpenChange,
  selectedPlan,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const idPrefix = `r-phase-${topic.toLowerCase()}`;
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
      topic,
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

  function reset() {
    formRef.current?.reset();
    setStatus("idle");
    setErrorMessage(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="r-btn r-btn-ink r-phase-cta-toggle"
        aria-expanded={false}
        aria-controls={formId}
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          justifyContent: "center",
          marginTop: "auto",
        }}
      >
        Get in touch <span className="arrow">→</span>
      </button>
    );
  }

  if (status === "success") {
    return (
      <div
        id={formId}
        className="r-phase-cta-form r-contact-success"
        role="status"
        aria-live="polite"
        style={{ marginTop: "auto" }}
      >
        <h4 style={{ margin: 0, fontSize: 16 }}>Thanks, we have it.</h4>
        <p style={{ margin: "8px 0 12px", fontSize: 13 }}>
          A Relay partner will reply within one business day.
        </p>
        <button type="button" className="r-btn r-btn-ghost" onClick={reset}>
          Send another
        </button>
      </div>
    );
  }

  const submitting = status === "submitting";
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;

  return (
    <form
      ref={formRef}
      id={formId}
      className="r-phase-cta-form r-contact-form"
      onSubmit={onSubmit}
      noValidate
      aria-label="Inquiry"
      style={{ marginTop: "auto" }}
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

      <div className="r-contact-field">
        <label htmlFor={`${idPrefix}-company`}>
          Company <em>(optional)</em>
        </label>
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
        <label htmlFor={`${idPrefix}-message`}>Message</label>
        <textarea
          id={`${idPrefix}-message`}
          name="message"
          rows={4}
          required
          minLength={10}
          maxLength={4000}
          disabled={submitting}
          defaultValue={
            selectedPlan
              ? `I'd like to discuss the ${selectedPlan.name} option (${selectedPlan.priceLabel}).\n\n`
              : undefined
          }
          placeholder="What are you building? What would success look like?"
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      </div>

      <p
        style={{
          margin: "0 0 12px",
          fontSize: 11,
          color: "var(--ink-mute)",
          lineHeight: 1.5,
        }}
      >
        * Goes straight to your Relay engineer. Want a custom quote? Say so in
        the message and submit.
      </p>

      {errorMessage && (
        <div id={errorId} className="r-contact-error" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="r-contact-actions r-phase-cta-actions">
        <button
          type="submit"
          className="r-btn r-btn-green"
          disabled={submitting}
        >
          {submitting ? "Sending" : "Send"}{" "}
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </button>
        <button
          type="button"
          className="r-btn r-btn-ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
