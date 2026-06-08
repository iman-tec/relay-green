/*
 * Submit helper for the public /partner/apply form.
 *
 * Posts to POST /api/partner/apply, which writes a durable
 * partner_applications row (the source of truth) and best-effort emails the
 * team + applicant.
 *
 * Unlike submitContact / submitEnterpriseRequest, there is NO mailto: fallback
 * on a 5xx: the structured application can only be captured by the DB write, so
 * a silent mailto "success" would lose it. A backend failure surfaces as an
 * error the form shows, prompting a retry (or a direct email to partners@).
 */

export type PartnerApplicationPayload = {
  contactName: string;
  workEmail: string;
  companyName: string;
  companyWebsite: string;
  countryRegion: string;
  clientsText: string;
  heardAbout?: string;
  anythingElse?: string;
  /** Honeypot value; populated only by bots. Forward as-is. */
  website?: string;
};

export type PartnerApplicationResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "server" };

export async function submitPartnerApplication(
  payload: PartnerApplicationPayload
): Promise<PartnerApplicationResult> {
  let res: Response;
  try {
    res = await fetch("/api/partner/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "server" };
  }

  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status >= 400 && res.status < 500)
    return { ok: false, error: "invalid" };
  return { ok: false, error: "server" };
}
