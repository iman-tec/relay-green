/*
 * /pricing, dedicated tier page.
 *
 * Lifts the existing PricingTiers component (Free / Pro / Max / Teams) onto
 * its own surface so the site has a canonical URL for "rent a senior
 * engineer" + "engineer on call" search intent. Adds Service +
 * AggregateOffer JSON-LD via lib/seo/schema for rich-result eligibility.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";
import { PricingTiers } from "../_marketing/PricingTiers";
import { TryRelayButton } from "../_marketing/TryRelayButton";
import { JsonLd } from "../_marketing/JsonLd";
import { CtaBanner } from "../_marketing/CtaBanner";
import {
  serviceSchema,
  breadcrumbSchema,
  webPageSchema,
  faqSchema,
} from "../../lib/seo/schema";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free for the first session. Pro for solo builders. Max for solo founders running revenue on AI builds. Teams for 50+ builders. Talk to us for enterprise.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing, Relay",
    description:
      "Free, Pro, Max, Teams. Same engineer across sessions on Pro and up. SOC 2 + GDPR posture on Teams.",
    url: "/pricing",
  },
};

const SITE_URL = "https://www.relay.green";

const FAQ = [
  {
    q: "Is Free really free?",
    a: "Yes. One engineer session per month, chat modality, any of nine AI tracks. No card on file.",
  },
  {
    q: "Can I get the same engineer every time?",
    a: "On Pro and up, yes. The first engineer who picks up your press is matched on subsequent sessions when they're available; if not, the bench routes to someone with the same project context.",
  },
  {
    q: "What's the difference between Max and Teams?",
    a: "Max is for one builder running production on AI-built software. Teams is for an organization rolling Relay out to 50+ builders, with SSO, SCIM, audit logs, and a named engineer pod.",
  },
  {
    q: "Do you offer custom pricing for enterprises?",
    a: "Yes. Teams is a starting point; large rollouts negotiate volume terms, regional data residency, and named-pod sizing. Talk to sales@relay.green.",
  },
];

export default function PricingPage() {
  return (
    <Shell>
      <JsonLd
        data={[
          webPageSchema({
            url: `${SITE_URL}/pricing`,
            name: "Relay, Pricing",
            description:
              "Tiered pricing for on-demand human engineering: Free, Pro, Max, Teams.",
          }),
          breadcrumbSchema([
            { name: "Home", href: "/" },
            { name: "Pricing", href: "/pricing" },
          ]),
          serviceSchema(),
          faqSchema(FAQ.map((f) => ({ question: f.q, answer: f.a }))),
        ]}
      />

      <section className="r-section r-section-hero">
        <div className="r-wrap">
          <div className="r-eyebrow">
            <span>Pricing</span>
            <span className="r-mark-dot" aria-hidden="true"></span>
          </div>
          <h1 className="r-h-display" style={{ maxWidth: "16ch" }}>
            One press. Four ways <em>to commit.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Same bench, same bar, same engineer across sessions on Pro and up.
            Start free. Move up when the work moves up.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <PricingTiers />
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Pricing FAQ
          </h2>
          <dl style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: 20,
                    marginBottom: 6,
                  }}
                >
                  {item.q}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    color: "var(--ink-soft)",
                    lineHeight: 1.6,
                  }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Same dark closing banner as Home + product, so the three primary
          conversion surfaces all end with the identical brand statement. */}
      <CtaBanner />
    </Shell>
  );
}
