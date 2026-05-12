"use client";

/*
 * Consent-aware mount point for Vercel Analytics and Speed Insights.
 *
 * GDPR / DPDP / CCPA all distinguish strictly-necessary cookies from
 * analytics cookies. Vercel Analytics fires a beacon for every page load,
 * which is analytics-category, so we mount it only after the user has
 * explicitly accepted in CookieConsent.tsx (which writes "accepted" to
 * localStorage["relay.cookies"]).
 *
 * We use useSyncExternalStore so React subscribes to the consent value as
 * an external store rather than via a useEffect/setState dance. This is
 * the React 18+ pattern for hydration-safe, cascading-render-free
 * subscriptions to non-React state.
 *
 * Behavior:
 *   • If no choice has been made yet, render nothing (no beacons).
 *   • If choice is "accepted", mount <Analytics /> + <SpeedInsights />.
 *   • If choice is "rejected", render nothing.
 *   • Re-renders automatically when CookieConsent dispatches the
 *     "relay:cookies-changed" custom event (same tab) or when storage
 *     fires (other tabs).
 */

import { useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

const STORAGE_KEY = "relay.cookies";

type Choice = "accepted" | "rejected" | null;

function readChoice(): Choice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {
    // localStorage may be blocked in some browser modes; treat as no choice.
  }
  return null;
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("relay:cookies-changed", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("relay:cookies-changed", onStoreChange);
  };
}

// SSR snapshot: server has no localStorage, so consent is always "no choice"
// at render time. Real value comes in on the client after hydration.
const getServerSnapshot = (): Choice => null;

export function AnalyticsGate() {
  const choice = useSyncExternalStore(subscribe, readChoice, getServerSnapshot);
  if (choice !== "accepted") return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
