/*
 * /legal/terms-of-use — Terms of Use for the Relay.green platform.
 *
 * The content reflects Relay's product model as documented in the site
 * copy and product spec: prepaid hour-bucket plans, real engineers
 * joining AI build sessions, multi-role surfaces (Customer / Engineer /
 * Supervisor / Enterprise Admin / Internal Admin), Stripe-powered
 * checkout, multi-currency pricing (EUR / USD / GBP / INR), and
 * operational backing by NINtec Systems (Gateway Group). Update the
 * `Last updated:` line in the hero whenever this text changes.
 */

import type { Metadata } from "next";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms governing access to and use of the Relay.green platform — prepaid engineering support sessions, account responsibilities, payment terms, intellectual property, confidentiality, acceptable use, and liability.",
  alternates: { canonical: "/legal/terms-of-use" },
};

const h2Style: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  fontSize: "clamp(20px, 1.8vw, 26px)",
  letterSpacing: "-0.012em",
  lineHeight: 1.2,
  color: "var(--ink)",
  margin: "36px 0 14px",
};

const h3Style: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: "-0.005em",
  lineHeight: 1.3,
  color: "var(--ink)",
  margin: "22px 0 8px",
};

const pStyle: React.CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.65,
  color: "var(--ink-soft)",
  margin: "0 0 12px",
};

const ulStyle: React.CSSProperties = {
  margin: "0 0 12px",
  paddingLeft: 22,
  color: "var(--ink-soft)",
  fontSize: 14.5,
  lineHeight: 1.65,
};

export default async function TermsOfUsePage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  // `?embed=1` is set by the cookie-consent preview iframe so this
  // page renders without Nav/Footer — the user can read the terms
  // but cannot click through into the rest of the site before
  // accepting cookies.
  const params = await searchParams;
  const embed = params.embed === "1";

  return (
    <Shell bare={embed}>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Terms of Use</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Terms of Use.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            These Terms govern your access to and use of the Relay.green
            platform. By using the platform you agree to be bound by them.
          </p>
          <p
            style={{
              marginTop: 18,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-mute)",
            }}
          >
            Last updated: May 2026
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{
          paddingTop: 48,
          borderTop: "none",
          background: "#f5f5f7",
        }}
      >
        <div className="r-wrap-narrow">
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #d2d2d7",
              borderRadius: 8,
              padding: "clamp(28px, 5vw, 52px)",
              boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
            }}
          >
            <h2 style={{ ...h2Style, marginTop: 0 }}>1. Acceptance of terms</h2>
            <p style={pStyle}>
              These Terms of Use (the &ldquo;Terms&rdquo;) constitute a binding
              agreement between you (&ldquo;you&rdquo;, &ldquo;your&rdquo;,
              &ldquo;Customer&rdquo;) and Relay.green (&ldquo;Relay&rdquo;,
              &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) governing
              your access to and use of the website at relay.green and the Relay
              platform, including any associated tools, applications,
              documentation, and services (collectively, the
              &ldquo;Service&rdquo;).
            </p>
            <p style={pStyle}>
              By creating an account, purchasing a plan, or otherwise using the
              Service, you confirm that you have read, understood, and agreed to
              be bound by these Terms and our{" "}
              <a
                href="/legal/privacy-policy"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                Privacy Policy
              </a>
              . If you do not agree, do not use the Service.
            </p>

            <h2 style={h2Style}>2. The Service</h2>
            <p style={pStyle}>
              Relay connects people building software with AI development tools
              (such as Claude, Cursor, Lovable, Replit, v0, Bolt, Windsurf,
              ChatGPT, Copilot, and Gemini) to qualified human software
              engineers for real-time engineering support. Customers press the
              green dot, and a stack-matched engineer joins the session —
              typically within seconds — to assist with debugging, deployment,
              integrations, scaling, production readiness, and ongoing
              maintenance.
            </p>
            <p style={pStyle}>
              The Service is delivered in three engagement phases:
            </p>
            <ul style={ulStyle}>
              <li>
                <strong>Build Phase</strong> — on-demand sessions while your AI
                tool takes a build from concept to MVP.
              </li>
              <li>
                <strong>Launch Phase</strong> — a Relay engineer takes the wheel
                through launch on a fixed scope, fixed price, calendar promise.
              </li>
              <li>
                <strong>Maintain & Scale Phase</strong> — monthly retainer where
                the same engineering team keeps your product shipping, secure,
                and current.
              </li>
            </ul>

            <h2 style={h2Style}>3. Eligibility &amp; accounts</h2>
            <p style={pStyle}>
              You must be at least 18 years old, or the age of legal majority in
              your jurisdiction, to use the Service. By using the Service you
              represent and warrant that you meet this requirement and have the
              legal capacity to enter into these Terms.
            </p>
            <p style={pStyle}>
              You are responsible for maintaining the confidentiality of your
              account credentials and for all activity that occurs under your
              account. You agree to notify us immediately at{" "}
              <a
                href="mailto:support@relay.green"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                support@relay.green
              </a>{" "}
              of any unauthorised use of your account.
            </p>

            <h2 style={h2Style}>4. Plans, payment &amp; refunds</h2>
            <h3 style={h3Style}>4.1 Prepaid hour-buckets</h3>
            <p style={pStyle}>
              Customer access is sold as prepaid hour-buckets. A bucket entitles
              you to a defined volume of engineering session time, billed in
              minute-precision increments against the bucket balance. The
              available bucket sizes, prices, and minimum session lengths are
              published on{" "}
              <a
                href="/pricing"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                /pricing
              </a>{" "}
              and may be updated from time to time. Once purchased, a bucket is
              valid for twelve (12) months from the date of activation unless a
              different validity period is stated for that specific plan.
            </p>

            <h3 style={h3Style}>4.2 Currencies &amp; tax</h3>
            <p style={pStyle}>
              Plans are priced in EUR, USD, GBP, and INR. The currency displayed
              at checkout is the currency you will be billed in. Stated prices
              are exclusive of taxes unless otherwise indicated; applicable
              taxes will be added at checkout based on your billing location.
            </p>

            <h3 style={h3Style}>4.3 Payments</h3>
            <p style={pStyle}>
              Payments are processed by Stripe. By submitting payment details,
              you authorise Relay (through Stripe) to charge the applicable
              amount to your chosen payment method. You are responsible for the
              accuracy of the payment information provided.
            </p>

            <h3 style={h3Style}>4.4 Refunds &amp; cancellations</h3>
            <p style={pStyle}>
              Except where required by applicable consumer-protection law,
              hour-bucket purchases are non-refundable once activated. Unused
              minutes within an active bucket carry across the validity period.
              Enterprise and retainer engagements are governed by the order form
              or master agreement signed for those services.
            </p>

            <h2 style={h2Style}>5. Sessions with engineers</h2>
            <p style={pStyle}>
              When you press the green dot, Relay routes your request to a
              stack-matched human engineer. Sessions may include text chat,
              voice, screen sharing, and code review. Sessions are recorded for
              quality, supervision, and audit purposes; see the{" "}
              <a
                href="/legal/privacy-policy"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                Privacy Policy
              </a>{" "}
              for how session data is handled. Each session has a minimum billed
              duration as stated on{" "}
              <a
                href="/pricing"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                /pricing
              </a>{" "}
              (currently a 10-minute minimum); time beyond the minimum is billed
              against your bucket in minute-precision increments.
            </p>
            <p style={pStyle}>
              Relay does not guarantee that a session will resolve any specific
              issue. Engineers will use commercially reasonable skill and
              judgment; the Service is provided on a best-efforts basis and
              outcomes depend on the nature of the request, the state of your
              code and infrastructure, and the information you provide.
            </p>

            <h2 style={h2Style}>6. Your content &amp; intellectual property</h2>
            <p style={pStyle}>
              You retain all right, title, and interest in and to any code,
              data, documentation, designs, configurations, and other materials
              you provide to Relay or that an engineer produces specifically for
              you during a session (collectively, your &ldquo;Customer
              Content&rdquo;). You grant Relay a limited, non-exclusive,
              worldwide licence to access, copy, store, and process Customer
              Content solely as necessary to provide the Service.
            </p>
            <p style={pStyle}>
              Relay retains all right, title, and interest in and to the
              Service, the platform software, branding, methodologies, and any
              pre-existing or general-purpose tooling we use to deliver
              sessions. Nothing in these Terms transfers ownership of the
              Service to you.
            </p>

            <h2 style={h2Style}>7. AI-generated code</h2>
            <p style={pStyle}>
              The Service is designed to work alongside AI development tools.
              You acknowledge that AI-generated code may contain errors,
              security weaknesses, licence-incompatible content, or
              functionality that does not meet your requirements, and that you
              are solely responsible for the code you deploy. Relay engineers
              can review, modify, and harden AI-generated code on your behalf,
              but Relay does not warrant the AI tools you use and is not
              responsible for their output.
            </p>

            <h2 style={h2Style}>8. Confidentiality &amp; NDA</h2>
            <p style={pStyle}>
              Each engineer joining a Relay session is bound by a
              confidentiality agreement covering the Customer Content and
              session content they may access. Sessions are private by default.
              For enterprise engagements, Relay can execute a bilateral NDA,
              data-processing addendum, or other confidentiality terms upon
              request.
            </p>

            <h2 style={h2Style}>9. Acceptable use</h2>
            <p style={pStyle}>You agree not to use the Service to:</p>
            <ul style={ulStyle}>
              <li>
                infringe any third party&apos;s intellectual property, privacy,
                or other rights;
              </li>
              <li>
                build, ship, or maintain code that is unlawful, harmful,
                deceptive, harassing, defamatory, obscene, or that violates
                applicable export-control, sanctions, anti-money-laundering, or
                financial-crime laws;
              </li>
              <li>
                attempt to gain unauthorised access to the Service, other
                accounts, or the underlying systems;
              </li>
              <li>
                introduce malicious code, denial-of-service traffic, or any
                content designed to disrupt the Service or third-party systems;
              </li>
              <li>
                reverse-engineer, decompile, or otherwise attempt to extract the
                source code of the Service, except to the extent such
                restriction is prohibited by applicable law;
              </li>
              <li>
                resell, sublicence, or commercially exploit the Service outside
                the scope of your purchased plan.
              </li>
            </ul>
            <p style={pStyle}>
              We may suspend or terminate your access at our discretion if we
              reasonably believe you have breached these Terms or that continued
              access creates a risk to other customers, our engineers, or the
              integrity of the Service.
            </p>

            <h2 style={h2Style}>10. Third-party services</h2>
            <p style={pStyle}>
              The Service depends on third-party providers including payments
              (Stripe), real-time communications (Zoom Video SDK), identity
              providers, hosting, email, analytics, and AI providers (Anthropic
              and others). Your use of those services through Relay is subject
              to those providers&apos; own terms. Relay is not responsible for
              the acts or omissions of any third-party provider.
            </p>

            <h2 style={h2Style}>11. Service availability</h2>
            <p style={pStyle}>
              We endeavour to keep the Service available with high uptime, but
              we do not guarantee uninterrupted availability. The Service is
              provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
              basis and may be subject to planned maintenance, third-party
              outages, or unforeseen disruption. Service-level commitments, if
              any, are stated in the applicable order form.
            </p>

            <h2 style={h2Style}>12. Disclaimers</h2>
            <p style={pStyle}>
              To the maximum extent permitted by law, Relay disclaims all
              warranties of any kind, whether express, implied, or statutory,
              including warranties of merchantability, fitness for a particular
              purpose, non-infringement, accuracy, and quiet enjoyment. No
              advice or information obtained from Relay creates any warranty not
              expressly stated in these Terms.
            </p>

            <h2 style={h2Style}>13. Limitation of liability</h2>
            <p style={pStyle}>
              To the maximum extent permitted by law, in no event shall Relay,
              its operating partners (including NINtec Systems and the Gateway
              Group), or its engineers be liable for any indirect, incidental,
              special, consequential, exemplary, or punitive damages, or for any
              loss of profits, revenue, data, goodwill, or business opportunity,
              arising out of or relating to the Service, even if advised of the
              possibility of such damages.
            </p>
            <p style={pStyle}>
              Relay&apos;s total aggregate liability arising out of or relating
              to these Terms or the Service, however caused, shall not exceed
              the amount paid by you to Relay in the twelve (12) months
              immediately preceding the event giving rise to the claim, or one
              hundred euros (€100), whichever is greater.
            </p>

            <h2 style={h2Style}>14. Indemnity</h2>
            <p style={pStyle}>
              You agree to defend, indemnify, and hold harmless Relay and its
              affiliates, officers, employees, and engineers from and against
              any claims, damages, liabilities, costs, and expenses (including
              reasonable legal fees) arising out of (i) your use of the Service
              in breach of these Terms, (ii) your Customer Content, or (iii)
              your violation of any applicable law or third-party right.
            </p>

            <h2 style={h2Style}>15. Termination</h2>
            <p style={pStyle}>
              You may stop using the Service at any time. We may suspend or
              terminate your access for breach of these Terms, for legal or
              regulatory reasons, or where continued service is no longer
              commercially viable, on reasonable notice except where immediate
              suspension is required to protect the platform or other users.
              Sections that by their nature should survive termination
              (including intellectual property, confidentiality, disclaimers,
              limitation of liability, indemnity, and governing law) will
              survive.
            </p>

            <h2 style={h2Style}>16. Changes to these Terms</h2>
            <p style={pStyle}>
              We may update these Terms from time to time. Material changes will
              be communicated through the Service or by email to your account
              address. Continued use of the Service after the effective date of
              any update constitutes acceptance of the revised Terms. If you do
              not agree, you must stop using the Service before the update takes
              effect.
            </p>

            <h2 style={h2Style}>17. Governing law &amp; disputes</h2>
            <p style={pStyle}>
              These Terms are governed by and construed in accordance with the
              laws of the jurisdiction stated in your order form or, if none is
              stated, the laws of England and Wales, without regard to
              conflict-of-law principles. The parties agree to submit to the
              exclusive jurisdiction of the courts of that jurisdiction for any
              dispute arising out of or relating to these Terms, save that
              either party may seek injunctive relief in any competent court to
              protect its intellectual property or confidential information.
            </p>

            <h2 style={h2Style}>18. Miscellaneous</h2>
            <p style={pStyle}>
              These Terms, together with any order form, the Privacy Policy, and
              any other policies referenced herein, constitute the entire
              agreement between you and Relay relating to the Service. If any
              provision is held unenforceable, the remaining provisions will
              continue in full force. Failure to enforce any provision is not a
              waiver. You may not assign these Terms without our prior written
              consent; Relay may assign these Terms to an affiliate or in
              connection with a merger, acquisition, or sale of assets.
            </p>

            <h2 style={h2Style}>19. Contact</h2>
            <p style={pStyle}>
              Questions about these Terms can be sent to{" "}
              <a
                href="mailto:support@relay.green"
                style={{
                  color: "var(--green-deep)",
                  textDecoration: "underline",
                }}
              >
                support@relay.green
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </Shell>
  );
}
