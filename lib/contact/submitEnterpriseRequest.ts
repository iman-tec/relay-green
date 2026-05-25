/*
 * Submit helper for the enterprise inquiry form.
 *
 * Posts to POST /api/enterprise-request (which stores the lead in
 * public.enterprise_requests and emails it). Mirrors submitContact's
 * contract — falls back to a mailto: on network/5xx so a backend outage
 * can't kill the inquiry path; 4xx/429 surface to the caller.
 *
 * Used by EnterpriseCtaButton and EnterpriseCta.
 */

export type EnterpriseRequestPayload = {
  name: string;
  email: string;
  company?: string;
  message: string;
  /** Selected channel partner id (from the list), or "" when "Other" / none. */
  channelPartnerId?: string;
  /** Free-text channel partner name when "Other" is chosen (not in the list). */
  channelPartnerName?: string;
  /** Honeypot value; populated only by bots. Forward as-is. */
  website?: string;
};

export type EnterpriseSubmitResult =
  | { ok: true; deliveredVia: "api" | "mailto" }
  | { ok: false; error: "invalid" | "rate_limited" | "network" };

const MAILTO_TARGET = "hello@relay.green";

function openMailtoFallback(p: EnterpriseRequestPayload): void {
  if (typeof window === "undefined") return;
  const body = [
    `Name: ${p.name}`,
    `Email: ${p.email}`,
    p.company ? `Company: ${p.company}` : "",
    "",
    p.message,
  ]
    .filter(Boolean)
    .join("\n");
  window.location.href = `mailto:${MAILTO_TARGET}?subject=${encodeURIComponent(
    "Relay enterprise request"
  )}&body=${encodeURIComponent(body)}`;
}

export async function submitEnterpriseRequest(
  payload: EnterpriseRequestPayload
): Promise<EnterpriseSubmitResult> {
  let res: Response;
  try {
    res = await fetch("/api/enterprise-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    openMailtoFallback(payload);
    return { ok: true, deliveredVia: "mailto" };
  }

  if (res.ok) return { ok: true, deliveredVia: "api" };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status >= 400 && res.status < 500) return { ok: false, error: "invalid" };

  // 5xx — backend reachable but broken; mailto so the user still reaches us.
  openMailtoFallback(payload);
  return { ok: true, deliveredVia: "mailto" };
}
