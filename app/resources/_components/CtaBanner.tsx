/*
 * Closing CTA banner used at the bottom of every resource piece.
 *
 * Previously rendered a unique per-article headline + a single Try Relay
 * button. That diverged from the rest of the site (which uses the
 * canonical "AI changed who can build / RELAY changes the way they
 * ship" heading + 3 numbered promise pillars + Try Relay / Talk to
 * sales buttons). Now this component delegates to the shared
 * `_marketing/CtaBanner` so every article closes with the same brand
 * banner as Home / product / pricing / resources hub.
 *
 * The `headlineHtml` prop is kept in the public API for compatibility
 * with every article page that already passes one, but it's
 * intentionally ignored — the unified banner uses canonical brand copy.
 * If any future page ever needs a custom heading at this surface, it
 * can be threaded through the shared component's `heading` prop.
 */

import { CtaBanner as SharedCtaBanner } from "../../_marketing/CtaBanner";

export function CtaBanner(props: { headlineHtml?: string }) {
  void props;
  return <SharedCtaBanner />;
}
