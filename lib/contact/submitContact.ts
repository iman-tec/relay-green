/*
 * Shared contact-form submit helper.
 *
 * Posts to POST /api/contact first. If the backend is unreachable or
 * returns a server error (5xx, network failure), the helper falls back
 * to opening the user's mail client at hello@relay.green so a backend
 * outage cannot kill the inquiry path. Validation errors (4xx) and rate
 * limits (429) surface to the caller as `{ ok: false, error }` so the
 * form can show the right message.
 *
 * Used by EnterpriseCtaButton, EnterpriseCta, PhaseCtaForm, and the
 * /company/about ContactForm. Keep the contract on this helper stable —
 * those four call sites all key off the same shape.
 */

export type ContactFormPayload = {
  name: string;
  email: string;
  company?: string;
  topic: string;
  message: string;
  marketingConsent?: boolean;
  /** Honeypot value; populated only by bots. Always forward as-is. */
  website?: string;
};

export type ContactSubmitResult =
  /** Backend accepted (or honeypot silently dropped the post). */
  | { ok: true; deliveredVia: "api" | "mailto" }
  /** Backend rejected with a user-visible reason. */
  | { ok: false; error: "invalid" | "rate_limited" | "network" };

const MAILTO_TARGET = "hello@relay.green";

function openMailtoFallback(payload: ContactFormPayload): void {
  if (typeof window === "undefined") return;
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
  window.location.href = `mailto:${MAILTO_TARGET}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

export async function submitContact(
  payload: ContactFormPayload
): Promise<ContactSubmitResult> {
  let res: Response;
  try {
    res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network / DNS / offline. Mailto is the right fallback — the user
    // still gets a way to send their message.
    openMailtoFallback(payload);
    return { ok: true, deliveredVia: "mailto" };
  }

  if (res.ok) {
    return { ok: true, deliveredVia: "api" };
  }

  if (res.status === 429) {
    return { ok: false, error: "rate_limited" };
  }

  if (res.status >= 400 && res.status < 500) {
    return { ok: false, error: "invalid" };
  }

  // 5xx — backend reachable but broken. Fall back to mailto so the
  // user can still reach us; report as ok so the form doesn't error.
  openMailtoFallback(payload);
  return { ok: true, deliveredVia: "mailto" };
}
