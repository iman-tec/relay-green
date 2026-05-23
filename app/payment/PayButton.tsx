"use client";

/*
 * Pay button for the /payment page.
 *
 * Relay's purchase happens in-app, authenticated (the PaywallModal +
 * create-relay-checkout edge function), so this marketing-side button no
 * longer calls a standalone /api/checkout. Instead it sends the visitor into
 * the existing flow: sign in, then complete the purchase in the app. The
 * chosen plan is carried through so the app can pre-select it.
 */

import { useState } from "react";

export function PayButton({ planId }: { planId: string }) {
  const [submitting, setSubmitting] = useState(false);

  function onClick() {
    if (submitting) return;
    setSubmitting(true);
    // Hand off to the existing authenticated purchase flow.
    const params = new URLSearchParams({ next: "/room", plan: planId });
    window.location.assign(`/login?${params.toString()}`);
  }

  return (
    <button
      type="button"
      className="r-btn r-btn-green"
      onClick={onClick}
      disabled={submitting}
      style={{ width: "100%", justifyContent: "center" }}
    >
      {submitting ? "Redirecting" : "Continue"}{" "}
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}
