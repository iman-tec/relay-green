import type { Metadata } from "next";
import { Suspense } from "react";
import { IntakeClient } from "./IntakeClient";

export const metadata: Metadata = {
  title: "Find an engineer — Relay.green",
};

// IntakeClient uses useSearchParams() to read ?projectId. Next.js 16
// requires a Suspense boundary around any client component that does so;
// without it static prerender bails out with "missing-suspense-with-csr-
// bailout". A near-empty fallback is fine — the wizard is fully client-
// driven and only renders user-visible content once auth resolves.
export default function IntakePage() {
  return (
    <Suspense fallback={<IntakeFallback />}>
      <IntakeClient />
    </Suspense>
  );
}

function IntakeFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center text-sm"
      style={{ color: "var(--text-muted)" }}
    >
      Loading…
    </div>
  );
}
