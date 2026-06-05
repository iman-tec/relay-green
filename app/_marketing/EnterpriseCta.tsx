"use client";

/*
 * Enterprise CTA band that sits below the three Build/Launch/Maintain
 * pricing cards on the marketing home. The button reveals a compact
 * inline form (instead of navigating to /company/contact) so a prospect
 * researching custom pricing can submit without leaving the section.
 *
 * Submissions POST to /api/contact via lib/contact/submitContact.ts with
 * topic="ENTERPRISE". On 5xx the helper falls back to opening mailto:
 * so the inquiry path survives a backend outage.
 */

import { useEffect, useRef, useState } from "react";
import { submitEnterpriseRequest } from "../../lib/contact/submitEnterpriseRequest";

type Status = "idle" | "submitting" | "success" | "error";
type ChannelPartner = { id: string; name: string };

// Sentinel for the "Other — not listed" dropdown option.
const OTHER_PARTNER = "__other__";

export function EnterpriseCta() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partners, setPartners] = useState<ChannelPartner[]>([]);
  const [partnerChoice, setPartnerChoice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Lazy-load the channel-partner list the first time the form opens.
  useEffect(() => {
    if (!open || partners.length > 0) return;
    let cancelled = false;
    fetch("/api/channel-partners", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channelPartners: [] }))
      .then((d: { channelPartners?: ChannelPartner[] }) => {
        if (!cancelled) setPartners(d.channelPartners ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, partners.length]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;

    const form = e.currentTarget;
    const data = new FormData(form);

    // Channel partner is required: pick from the list, or "Other" + a name.
    const customPartner = String(data.get("channelPartnerOther") ?? "").trim();
    if (
      !partnerChoice ||
      (partnerChoice === OTHER_PARTNER && customPartner.length === 0)
    ) {
      setStatus("error");
      setErrorMessage(
        "Please choose a channel partner — or pick “Other” and type a name."
      );
      return;
    }

    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      company: String(data.get("company") ?? ""),
      message: String(data.get("message") ?? ""),
      channelPartnerId: partnerChoice === OTHER_PARTNER ? "" : partnerChoice,
      channelPartnerName: partnerChoice === OTHER_PARTNER ? customPartner : "",
      website: String(data.get("website") ?? ""),
    };

    setStatus("submitting");
    setErrorMessage(null);
    const result = await submitEnterpriseRequest(payload);
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
    setPartnerChoice("");
  }

  const submitting = status === "submitting";
  const errorId = "r-enterprise-form-error";
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;

  return (
    <div className="r-leg r-leg-enterprise" data-open={open ? "true" : "false"}>
      {open && (
        <button
          type="button"
          className="r-leg-enterprise-close"
          aria-label="Close form"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <div className="r-leg-enterprise-intro">
        <h3 className="r-leg-title" style={{ marginTop: 0 }}>
          Enterprise
        </h3>
        <div className="r-leg-tag">
          <span className="mk-sweep">You scale. We embed.</span>
        </div>
        <p className="r-leg-desc" style={{ marginTop: 8, marginBottom: 0 }}>
          Org-wide rollouts, custom retainers, regulated and multi-region work.
          We quote on what you actually need.
        </p>
      </div>

      {!open && (
        <button
          type="button"
          className="r-btn r-btn-ink r-leg-enterprise-cta"
          aria-expanded={false}
          aria-controls="r-enterprise-form"
          onClick={() => setOpen(true)}
        >
          Get in touch <span className="arrow">→</span>
        </button>
      )}

      {open && status === "success" && (
        <div
          id="r-enterprise-form"
          className="r-leg-enterprise-form r-contact-success"
          role="status"
          aria-live="polite"
        >
          <h4 style={{ margin: 0 }}>Thanks, we have it.</h4>
          <p style={{ margin: "8px 0 16px" }}>
            A Relay partner will reply within one business day.
          </p>
          <button type="button" className="r-btn r-btn-ghost" onClick={reset}>
            Send another message
          </button>
        </div>
      )}

      {open && status !== "success" && (
        <form
          ref={formRef}
          id="r-enterprise-form"
          className="r-leg-enterprise-form r-contact-form"
          onSubmit={onSubmit}
          noValidate
          aria-label="Enterprise inquiry"
        >
          <div aria-hidden="true" className="r-honeypot">
            <label htmlFor="r-enterprise-website">Website</label>
            <input
              id="r-enterprise-website"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <div className="r-contact-row">
            <div className="r-contact-field">
              <label htmlFor="r-enterprise-name">Your name</label>
              <input
                id="r-enterprise-name"
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
              <label htmlFor="r-enterprise-email">Your email</label>
              <input
                id="r-enterprise-email"
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
            <label htmlFor="r-enterprise-company">Company</label>
            <input
              id="r-enterprise-company"
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
            <label htmlFor="r-enterprise-channel-partner">
              Channel partner
            </label>
            <select
              id="r-enterprise-channel-partner"
              name="channelPartnerId"
              required
              value={partnerChoice}
              onChange={(e) => setPartnerChoice(e.target.value)}
              disabled={submitting}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              <option value="" disabled>
                Select a channel partner…
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={OTHER_PARTNER}>Other (not listed)…</option>
            </select>
          </div>

          {partnerChoice === OTHER_PARTNER && (
            <div className="r-contact-field">
              <label htmlFor="r-enterprise-channel-partner-other">
                Channel partner name
              </label>
              <input
                id="r-enterprise-channel-partner-other"
                type="text"
                name="channelPartnerOther"
                maxLength={160}
                required
                disabled={submitting}
                placeholder="Type the channel partner's name"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}

          <div className="r-contact-field">
            <label htmlFor="r-enterprise-message">
              Tell us what custom looks like
            </label>
            <textarea
              id="r-enterprise-message"
              name="message"
              rows={5}
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
            <span className="r-contact-meta">
              Goes straight to a partner. One business day.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
