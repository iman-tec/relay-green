"use client";

/*
 * Engineer "Quotation" surface — the global bid queue across ALL customers.
 *
 * Visually identical to the supervisor's /bids workspace (same two-column
 * layout: the act-now bid rail on the left, a persistent project-history AI
 * panel on the right, same mobile behaviour). It renders the shared
 * BidsWorkspace in its ENGINEER variant, which:
 *   - reads /api/staff/quote-requests (engineer-scoped queue),
 *   - surfaces the "Needs bid" bucket as the engineer's primary task (the
 *     supervisor hides it), and
 *   - submits bids into 'pending_review' for supervisor approval.
 * Only the page name differs from the supervisor ("Quotation" vs "Bids").
 */

import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { BidsWorkspace } from "../bids/BidsWorkspace";

export function QuotationsClient() {
  useRequireEngineerProfile();
  return (
    <BidsWorkspace
      variant="engineer"
      title="Quotation"
      subtitle="Quote requests across your customers. Open one to prepare a bid, and use “Review project history (AI)” — it opens in the panel on the right."
    />
  );
}
