"use client";

/*
 * Engineer "Quotation" surface — the global bid queue across ALL customers.
 *
 * QuoteRequestsInbox is a self-contained, cross-customer queue (it fetches
 * every pending quote request, not a per-person slice), so it lives on its own
 * route reachable from the sidebar rather than inside the per-customer inbox.
 */

import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { QuoteRequestsInbox } from "../inbox/QuoteRequestsInbox";

export function QuotationsClient() {
  useRequireEngineerProfile();
  return (
    <div className="flex h-full flex-col px-4 py-4 md:px-6 md:py-6">
      {/* h-full chains off <main>'s viewport height; the inner flex-1 + min-h-0
          lets QuoteRequestsInbox (h-full, internal scroll) fill and scroll
          without bubbling a second scrollbar onto <main>. */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <QuoteRequestsInbox />
      </div>
    </div>
  );
}
