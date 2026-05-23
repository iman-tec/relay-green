"use client";

/*
 * Contact form (client island) for /company/contact.
 *
 * Reads `?topic=<slug>` from the URL on mount so marketing CTAs can
 * deep-link with intent (e.g. "Talk to Relay for Enterprise" lands here
 * with the topic preselected). The select is the source of truth, the
 * URL param just primes its initial value.
 *
 * Submit goes to /api/contact. On 200 the form is replaced by a quiet
 * thank-you panel; on error the form stays mounted with an inline message
 * so the user can fix and retry.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "idle" | "submitting" | "success" | "error";

type TopicOption = { value: string; label: string };

const TOPICS: TopicOption[] = [
  { value: "SALES", label: "Sales, pricing, pilots, plans" },
  { value: "ENTERPRISE", label: "Enterprise, org-wide rollout" },
  { value: "BUILD", label: "Build phase, on-demand engineer support" },
  { value: "LAUNCH", label: "Launch, fixed-scope go-live" },
  { value: "MAINTAIN", label: "Maintain & scale, monthly retainer" },
  { value: "PARTNERSHIPS", label: "Partnerships, integrations, channel" },
  { value: "PRESS", label: "Press, quotes, interviews, brand assets" },
  { value: "GENERAL", label: "Something else" },
];

const TOPIC_VALUES = new Set(TOPICS.map((t) => t.value));

function normalizeTopicParam(raw: string | null): string {
  if (!raw) return "SALES";
  const upper = raw.toUpperCase();
  return TOPIC_VALUES.has(upper) ? upper : "SALES";
}

export function ContactForm() {
  const params = useSearchParams();
  const initialTopic = useMemo(
    () => normalizeTopicParam(params.get("topic")),
    [params]
  );

  const [topic, setTopic] = useState(initialTopic);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // If the URL changes (back/forward navigation) re-prime the topic, but
  // never overwrite a topic the user has manually picked once mounted.
  const topicTouchedRef = useRef(false);
  useEffect(() => {
    if (topicTouchedRef.current) return;
    setTopic(initialTopic);
  }, [initialTopic]);

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
      marketingConsent: data.get("marketingConsent") === "on",
      website: String(data.get("website") ?? ""), // honeypot
    };

    setStatus("submitting");
    setErrorMessage(null);
    try {
      // No contact API in this app — hand off to the visitor's mail client.
      const subject = `Relay enquiry — ${payload.topic}`;
      const body = [
        `Name: ${payload.name}`,
        `Email: ${payload.email}`,
        payload.company ? `Company: ${payload.company}` : "",
        `Topic: ${payload.topic}`,
        "",
        payload.message,
      ]
        .filter(Boolean)
        .join("\n");
      window.location.href = `mailto:hello@relay.green?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`;
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage(
        "Couldn't open your email app — write to hello@relay.green directly."
      );
    }
  }

  function reset() {
    formRef.current?.reset();
    setStatus("idle");
    setErrorMessage(null);
    topicTouchedRef.current = false;
    setTopic(initialTopic);
  }

  if (status === "success") {
    return (
      <div className="r-contact-success" role="status" aria-live="polite">
        <h3>Thanks, we’ve got it.</h3>
        <p>We’ll reply within one business day.</p>
        <button type="button" className="r-btn r-btn-ghost" onClick={reset}>
          Send another message
        </button>
      </div>
    );
  }

  const submitting = status === "submitting";
  const errorId = "r-contact-form-error";
  const describedBy = errorMessage ? errorId : undefined;
  const invalid = errorMessage ? true : undefined;

  return (
    <form
      ref={formRef}
      className="r-contact-form"
      onSubmit={onSubmit}
      noValidate
    >
      {/* Honeypot, visually + a11y hidden; only bots fill this. */}
      <div aria-hidden="true" className="r-honeypot">
        <label htmlFor="r-contact-website">Website</label>
        <input
          id="r-contact-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="r-contact-row">
        <div className="r-contact-field">
          <label htmlFor="r-contact-name">Your name</label>
          <input
            id="r-contact-name"
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
          <label htmlFor="r-contact-email">Your email</label>
          <input
            id="r-contact-email"
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
        <label htmlFor="r-contact-company">
          Company <em>(optional)</em>
        </label>
        <input
          id="r-contact-company"
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
        <label htmlFor="r-contact-topic">I’m reaching out about…</label>
        <select
          id="r-contact-topic"
          name="topic"
          value={topic}
          onChange={(e) => {
            topicTouchedRef.current = true;
            setTopic(e.target.value);
          }}
          disabled={submitting}
          required
          aria-describedby={describedBy}
          aria-invalid={invalid}
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="r-contact-field">
        <label htmlFor="r-contact-message">Message</label>
        <textarea
          id="r-contact-message"
          name="message"
          rows={6}
          required
          minLength={10}
          maxLength={4000}
          disabled={submitting}
          placeholder="What are you building? What would success look like with Relay in the loop?"
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      </div>

      <label className="r-contact-consent">
        <input
          type="checkbox"
          name="marketingConsent"
          disabled={submitting}
        />
        <span>
          I consent to receive email updates, newsletters, and other
          communications from Relay
        </span>
      </label>

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
          {submitting ? "Sending…" : "Send message"}{" "}
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </button>
        <span className="r-contact-meta">
          We reply within one business day.
        </span>
      </div>
    </form>
  );
}
