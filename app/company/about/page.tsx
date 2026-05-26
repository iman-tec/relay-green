/*
 * /company/about, Contact Us page.
 *
 * The previous company structure and identity blocks were removed from this
 * route and saved in docs/removed-company-about-blocks.md for later reuse.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { Shell } from "../../_marketing/Shell";
import { RelayLogo } from "../../_marketing/RelayLogo";
import { ContactForm } from "../contact/ContactForm";
import { HeroDot } from "./HeroDot";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Contact Relay for sales, enterprise rollouts, partnerships, press, security, and general questions.",
  alternates: { canonical: "/company/about" },
};

const DIRECT_LANES = [
  {
    label: "Email us directly",
    email: "support@relay.green",
    note: "Sales, partnerships, security, press, investors. One inbox, one business-day reply.",
  },
];

const CONTACT_HINTS = [
  "What you are building",
  "Where you are stuck",
  "Your timeline",
  "The AI tool or stack you are using",
];

export default function ContactPage() {
  return (
    <Shell>
      <section
        className="r-company-hero"
        style={{
          padding: "76px 0 58px",
          background: "var(--paper)",
          borderBottom: "1px solid #d2d2d7",
        }}
      >
        <div className="r-wrap">
          <div className="r-contact-hero-grid">
            <div className="r-contact-hero-text">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--green)",
                    display: "inline-block",
                  }}
                  aria-hidden="true"
                />
                Contact Us
              </div>
              <h1
                className="r-h-display"
                style={{
                  margin: 0,
                  maxWidth: 680,
                  fontSize: "clamp(42px, 5vw, 72px)",
                  letterSpacing: "-0.04em",
                  lineHeight: 0.98,
                }}
              >
                Talk to <RelayLogo size="0.82em" />.
              </h1>
              <p
                className="r-lede"
                style={{
                  marginTop: 24,
                  maxWidth: "58ch",
                  color: "var(--ink-soft)",
                }}
              >
                Tell us what you are building, where you are in the process, and
                what kind of help you need. A real person will reply within one
                business day.
              </p>
            </div>
            <HeroDot />
          </div>
        </div>
      </section>

      <section
        id="contact"
        className="r-section r-contact-section"
        style={{
          padding: "72px 0 96px",
          background: "var(--cream-2)",
          borderTop: "none",
        }}
      >
        <div className="r-wrap">
          <div className="r-contact-grid">
            <div className="r-contact-form-col">
              <Suspense
                fallback={
                  <div className="r-contact-form" aria-hidden="true">
                    Loading...
                  </div>
                }
              >
                <ContactForm />
              </Suspense>
            </div>

            <aside className="r-contact-aside">
              <h2 className="r-contact-aside-h">Reach Relay</h2>
              <p className="r-contact-aside-blurb">
                Use the form for sales, enterprise rollouts, partnerships,
                press, security, and general questions.
              </p>

              <ul className="r-contact-lanes">
                {DIRECT_LANES.map((lane) => (
                  <li key={lane.label}>
                    <div className="r-contact-lane-label">{lane.label}</div>
                    <a
                      className="r-contact-lane-email"
                      href={`mailto:${lane.email}`}
                    >
                      {lane.email}
                    </a>
                    <p className="r-contact-lane-note">{lane.note}</p>
                  </li>
                ))}
              </ul>

              <div
                style={{
                  borderTop: "1px solid #d2d2d7",
                  paddingTop: 22,
                  marginTop: 4,
                }}
              >
                <h3 className="r-contact-aside-h">Helpful context</h3>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "16px 0 0",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {CONTACT_HINTS.map((hint) => (
                    <li
                      key={hint}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 13,
                        color: "var(--ink-soft)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: "var(--green)",
                          flex: "0 0 auto",
                        }}
                        aria-hidden="true"
                      />
                      {hint}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </Shell>
  );
}
