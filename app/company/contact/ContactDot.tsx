"use client";

/*
 * Small interactive sphere that lives at the bottom of the contact-page
 * aside, under the direct-email lane. Same Try Relay modal as the big
 * sphere on the homepage, just sized for the column.
 */

import { useTryRelay } from "../../_marketing/TryRelayProvider";

export function ContactDot() {
  const { open } = useTryRelay();
  return (
    <div className="r-contact-dot">
      <button
        type="button"
        className="r-contact-dot-sphere"
        onClick={open}
        aria-label="Press the dot to start a Relay session"
      />
      <p className="r-contact-dot-caption">One press. That&rsquo;s it.</p>
    </div>
  );
}
