/*
 * /payment/success — post-purchase landing page.
 *
 * Static thank-you. Relay's real purchase flow is the in-app, authenticated
 * checkout (PaywallModal → create-relay-checkout edge function), so this
 * marketing-side page no longer verifies a Stripe session server-side (that
 * avoided pulling in the server-only `stripe` SDK and any new API route).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/app/_marketing/Shell";

export const metadata: Metadata = {
  title: "Thanks",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function PaymentSuccessPage() {
  return (
    <Shell>
      <section className="r-section">
        <div className="r-wrap" style={{ maxWidth: 640 }}>
          <h1 className="r-h-1" style={{ marginBottom: 12 }}>
            Thanks, we have it.
          </h1>
          <p
            style={{
              marginBottom: 16,
              color: "var(--ink-soft)",
              fontSize: 16,
            }}
          >
            A Relay partner will reach out within one business day to schedule
            your engineer.
          </p>

          <Link href="/" className="r-btn r-btn-ink">
            Back to home <span className="arrow">→</span>
          </Link>
        </div>
      </section>
    </Shell>
  );
}
