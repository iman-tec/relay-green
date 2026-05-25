/*
 * /legal/privacy-policy, Relay's privacy policy.
 *
 * Server component. Prose lifted from the section-10 working draft in
 * docs/sitemap-and-content-plan/. Update the `Last updated:` line in the
 * hero whenever this text changes.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What we collect, what we don't, how we use it, and where we store it. Plain English.",
  alternates: { canonical: "/legal/privacy-policy" },
};

// Typography — sized down + retuned to use the platform's --text /
// --text-muted tokens so the page picks up whichever theme (light / dark
// / espresso) the user is on. Was h3=24/h4=14/body=16 with cream-only
// var(--ink-mute); now 17/11/13 with theme-aware tokens.
const h3Style = {
  fontFamily: "var(--font-serif)",
  fontWeight: 500,
  fontSize: 17,
  marginTop: 22,
  marginBottom: 8,
  letterSpacing: "-0.01em",
  color: "var(--text)",
};

const h4Style = {
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginTop: 14,
  marginBottom: 5,
  color: "var(--text-muted)",
};

const bodyStyle = { fontSize: 13, lineHeight: 1.55, color: "var(--text)" };

const listStyle = {
  ...bodyStyle,
  paddingLeft: 18,
  marginTop: 5,
  marginBottom: 12,
};

const nestedListStyle = {
  ...bodyStyle,
  paddingLeft: 18,
  marginTop: 5,
  marginBottom: 5,
};

const footerLineStyle = {
  marginTop: 40,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--text-muted)",
};

export default async function PrivacyPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  // `?embed=1` is set by the cookie-consent preview iframe so this
  // page renders without Nav/Footer — the user can read the policy
  // but cannot click through into the rest of the site before
  // accepting cookies.
  const params = await searchParams;
  const embed = params.embed === "1";

  return (
    <Shell bare={embed}>
      <style>{`
        /* Platform-themed prose. All colors come from CSS custom
         * properties so light / dark / espresso each render correctly.
         * Sizes are notched down vs the prior marketing layout — body
         * dropped from 16→13, h3 from 24→18, h4 from 14→11 — so the
         * page fits tighter and feels more like internal docs than a
         * marketing landing. */
        .privacy-policy-prose {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: clamp(20px, 3vw, 36px);
          column-count: 2;
          column-gap: clamp(32px, 4vw, 56px);
          column-rule: 1px solid var(--border);
        }
        .privacy-policy-prose > p:first-child {
          font-size: 14px !important;
          line-height: 1.55 !important;
          color: var(--text);
          margin-top: 0;
        }
        .privacy-policy-prose > p:nth-child(2) {
          padding-bottom: 16px;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .privacy-policy-prose h3 {
          margin-top: 28px !important;
          padding-top: 20px;
          border-top: 1px solid var(--border);
          font-size: 18px !important;
          line-height: 1.2;
          color: var(--text) !important;
          break-after: avoid;
        }
        .privacy-policy-prose h3:first-of-type {
          margin-top: 0 !important;
          padding-top: 0;
          border-top: none;
        }
        .privacy-policy-prose h4 {
          margin-top: 18px !important;
          margin-bottom: 6px !important;
          color: var(--text-muted) !important;
          break-after: avoid;
        }
        .privacy-policy-prose p {
          max-width: none;
          color: var(--text);
        }
        .privacy-policy-prose ul {
          max-width: none;
          background: var(--surface-raised);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px 16px 12px 30px !important;
          break-inside: avoid;
        }
        .privacy-policy-prose ul ul {
          background: var(--surface);
          margin-top: 8px !important;
          margin-bottom: 4px !important;
        }
        .privacy-policy-prose li {
          margin-bottom: 6px;
          color: var(--text);
          font-size: 13px;
        }
        .privacy-policy-prose li:last-child {
          margin-bottom: 0;
        }
        @media (max-width: 640px) {
          .privacy-policy-prose {
            padding: 18px 16px;
            column-count: 1;
            column-gap: 0;
            column-rule: none;
          }
          .privacy-policy-prose ul {
            padding-left: 24px !important;
          }
        }
      `}</style>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Privacy Policy</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Privacy Policy.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: May 2026
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{
          paddingTop: 32,
          borderTop: "none",
          background: "var(--background)",
        }}
      >
        <div className="r-wrap privacy-policy-prose">
          <p className="r-body" style={bodyStyle}>
            This privacy policy sets out how Relay (collectively referred as
            “Relay”, “we”, “our”, “us”) collect, use, disclose, process, store,
            transfer and protect any personal information that you give us when
            you use our services or access our websites. This statement
            demonstrates our commitment to privacy rights.
          </p>

          <p className="r-body" style={bodyStyle}>
            Your right to privacy and the protection of your personal data is
            utmost importance to us. We protect your personal data in accordance
            with applicable laws and our data privacy policies. In addition,
            appropriate technical and organizational measures are adhered to, in
            order to protect your personal data against unauthorized or unlawful
            processing and/or against accidental loss, alteration, disclosure or
            access, or accidental or unlawful destruction of or damage.
          </p>

          <h3 style={h3Style}>Data we collect</h3>
          <p className="r-body" style={bodyStyle}>
            To provide, secure, improve, and support our platform, we may
            collect and store the following categories of information:
          </p>

          <h4 style={h4Style}>Personal and Account Information</h4>
          <p className="r-body" style={bodyStyle}>
            Personal data is information that can identify an individual, either
            on its own or when combined with other available information. We
            collect personal data only as needed to provide the services you
            choose to use, including responding to inquiries. Providing this
            information is voluntary, but if you choose not to provide requested
            details, we may be unable to deliver certain services.
          </p>
          <p className="r-body" style={bodyStyle}>
            Examples include:
          </p>
          <ul style={listStyle}>
            <li>
              Account details, such as your name, e-mail address, username,
              company name, billing address, and authentication credentials (for
              example, password hashes or third-party login identifiers).
            </li>
            <li>
              Communication information, including support requests, customer
              service interactions, survey responses, and communications sent
              through our platform.
            </li>
            <li>
              Payment and billing information, such as billing contact details,
              subscription status, transaction history, and partial payment
              identifiers. Payment card information is collected and processed
              directly by our third-party payment processor(s), and we do not
              store or have access to your full card number or sensitive
              authentication data.
            </li>
          </ul>

          <h4 style={h4Style}>Service Usage and Workflow Data</h4>
          <p className="r-body" style={bodyStyle}>
            To operate the platform and fulfill service requests, we may
            collect:
          </p>
          <ul style={listStyle}>
            <li>
              Session telemetry and operational logs, particularly when requests
              are escalated for engineering or technical review, which may
              include:
              <ul style={nestedListStyle}>
                <li>AI tools or automated systems used,</li>
                <li>project or repository metadata,</li>
                <li>code diffs, patches, or transferred changes,</li>
                <li>prompts, instructions, and conversation history,</li>
                <li>
                  timestamps, duration, diagnostic events, and session outcomes.
                </li>
              </ul>
            </li>
            <li>
              User-submitted content, such as descriptions, bug reports,
              prompts, screenshots, uploaded files, code snippets,
              documentation, and other materials submitted as part of the
              workflow.
            </li>
            <li>
              Platform communications, including messages, comments, and file
              attachments exchanged between users, builders, developers, or
              support personnel through our built-in systems.
            </li>
          </ul>

          <h4 style={h4Style}>Technical and Device Information</h4>
          <p className="r-body" style={bodyStyle}>
            We may automatically collect certain technical information necessary
            for security, analytics, and service delivery, including:
          </p>
          <ul style={listStyle}>
            <li>Browser type and version,</li>
            <li>Device type, operating system, and hardware model,</li>
            <li>Log data, crash reports, and performance diagnostics,</li>
            <li>Session identifiers,</li>
            <li>Approximate geographic location derived from IP address,</li>
            <li>
              Referral URLs, pages visited, clickstream activity, and
              timestamps.
            </li>
          </ul>

          <h4 style={h4Style}>Cookies and Similar Technologies</h4>
          <p className="r-body" style={bodyStyle}>
            We may use cookies, local storage, pixels, or similar technologies
            to:
          </p>
          <ul style={listStyle}>
            <li>Maintain secure sessions,</li>
            <li>Remember preferences,</li>
            <li>Analyze platform performance,</li>
            <li>Improve usability,</li>
            <li>Prevent fraud and abuse.</li>
          </ul>

          <h4 style={h4Style}>Other Information You Provide</h4>
          <p className="r-body" style={bodyStyle}>
            Any additional information you voluntarily provide through digital,
            verbal, or physical means may be stored and processed as reasonably
            necessary for the purpose for which it was provided.
          </p>

          <h4 style={h4Style}>Non-Personal Data</h4>
          <p className="r-body" style={bodyStyle}>
            We may collect and retain data that does not directly identify you,
            including aggregated, anonymized, or de-identified information, for
            lawful business purposes including analytics, research, product
            development, security, and operational improvement.
          </p>
          <p className="r-body" style={bodyStyle}>
            Examples include:
          </p>
          <ul style={listStyle}>
            <li>Aggregate usage trends,</li>
            <li>Feature interaction metrics,</li>
            <li>Device and browser analytics,</li>
            <li>Performance benchmarks,</li>
            <li>Conversion metrics.</li>
          </ul>
          <p className="r-body" style={bodyStyle}>
            Where possible, device analytics may be offered on an opt-in basis.
            We take reasonable measures to ensure such analytics do not
            intentionally identify individual users or expose the contents of
            user devices.
          </p>

          <h4 style={h4Style}>Website Browsing Information</h4>
          <p className="r-body" style={bodyStyle}>
            When you visit our website, we may automatically collect
            single-session browsing information such as:
          </p>
          <ul style={listStyle}>
            <li>Pages viewed,</li>
            <li>Time spent on pages,</li>
            <li>Navigation patterns,</li>
            <li>Referring websites,</li>
            <li>Search terms,</li>
            <li>Device/browser metadata.</li>
          </ul>
          <p className="r-body" style={bodyStyle}>
            This information may be collected using cookies, analytics tools, or
            server logs to understand website usage and improve performance.
            Unless required for security, fraud prevention, or legal compliance,
            we generally do not associate this browsing data with directly
            identifiable individuals.
          </p>

          <h4 style={h4Style}>Data Retention</h4>
          <p className="r-body" style={bodyStyle}>
            We retain collected information for as long as reasonably necessary
            to:
          </p>
          <ul style={listStyle}>
            <li>Provide and maintain services,</li>
            <li>Comply with legal obligations,</li>
            <li>Resolve disputes,</li>
            <li>Enforce agreements,</li>
            <li>Improve platform functionality and security.</li>
          </ul>
          <p className="r-body" style={bodyStyle}>
            Retention periods may vary depending on the type of data, legal
            requirements, and legitimate business needs.
          </p>

          <h3 style={h3Style}>How we use your data</h3>
          <p className="r-body" style={bodyStyle}>
            We process information to provide and operate the services you have
            opted for, including matching tasks with developers, processing
            payments and billing, and sending transactional communications such
            as status updates, payment confirmations, and deadline reminders. We
            may also process information to investigate security incidents,
            prevent fraud, abuse, or unauthorized use of the platform, and
            improve our internal classifiers using aggregated and anonymized
            data only.
          </p>

          <h3 style={h3Style}>Who we share the data with</h3>
          <p className="r-body" style={bodyStyle}>
            The Relay engineer assigned to your session, for the duration of the
            session and any agreed retainer. Sub-processors listed at{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /trust/subprocessors
            </Link>{" "}
            (cloud, email, billing, observability) and such third-party service
            providers handling payment processing. To the authorities, when
            compelled by valid legal process and within the limits of applicable
            law.
          </p>

          <h3 style={h3Style}>Security and use of personal data</h3>
          <p className="r-body" style={bodyStyle}>
            Personal data is collected, used, and stored only for legitimate
            business purposes, including providing and improving our services,
            responding to inquiries, maintaining platform functionality, and
            meeting legal obligations. We maintain reasonable administrative,
            technical, and physical safeguards designed to protect the personal
            data in our possession, in accordance with applicable data
            protection and privacy laws. These safeguards include security
            policies, access controls, encryption where appropriate, monitoring
            systems, and internal procedures intended to help prevent
            unauthorized access, loss, misuse, disclosure, alteration, or
            destruction of personal data. Information stored through our
            platform is protected using industry-standard security measures,
            which may include firewalls, secure hosting infrastructure, and
            restricted access controls. While we take reasonable steps to
            safeguard your information, we are not responsible for risks or
            security events beyond our reasonable control.
          </p>

          <h3 style={h3Style}>Processing of personal data</h3>
          <p className="r-body" style={bodyStyle}>
            To operate our platform and provide services effectively, personal
            data you share with us may be accessed, processed, or shared with
            authorized team members, contractors, service providers, or
            technical partners located in different jurisdictions, where
            reasonably necessary for service delivery, support, security, or
            operational purposes. We take reasonable steps to ensure that such
            access is limited to appropriate purposes and subject to applicable
            confidentiality and data protection obligations.
          </p>
          <p className="r-body" style={bodyStyle}>
            We only collect, use, and process personal data where we have a
            valid legal basis to do so under applicable law, including:
          </p>
          <ul style={listStyle}>
            <li>Your consent, where required;</li>
            <li>Performance of services you request or agree to use;</li>
            <li>
              Our legitimate interests, such as operating, securing, improving,
              and supporting our platform, provided such interests are not
              overridden by your rights; or
            </li>
            <li>Compliance with applicable legal obligations.</li>
          </ul>
          <p className="r-body" style={bodyStyle}>
            Where cross-border data access or transfers are necessary, we take
            reasonable measures designed to protect your personal data in a
            manner consistent with applicable privacy and data protection
            requirements.
          </p>

          <h3 style={h3Style}>
            Disclosure to third parties & transfer of data
          </h3>
          <p className="r-body" style={bodyStyle}>
            We do not sell, trade or otherwise transfer your personal data to
            third parties for their independent marketing purposes. However, we
            may share personal data with trusted service providers, contractors,
            infrastructure partners, payment processors, analytics providers,
            professional advisors, or such third parties where reasonably
            necessary to operate our platform, deliver services, maintain
            security, process transactions, comply with legal obligations, or
            support legitimate business operations. Such third parties may only
            access personal data to the extent reasonably necessary for the
            services they provide to us or on our behalf, and are expected to
            handle such data subject to appropriate confidentiality, security,
            and applicable legal obligations. We ensure that before any such
            disclosure necessary steps are taken to ensure that your personal
            data will be given adequate protection as required by relevant data
            privacy laws.
          </p>
          <p className="r-body" style={bodyStyle}>
            We may also disclose personal data where reasonably necessary to:
          </p>
          <ul style={listStyle}>
            <li>
              Comply with applicable laws, regulations, legal processes, or
              lawful government requests;
            </li>
            <li>Enforce our terms, policies, or contractual rights;</li>
            <li>
              Detect, prevent, or address fraud, security, or technical issues;
              or
            </li>
            <li>
              Protect the rights, property, safety, or legitimate interests of
              our platform, users, or others.
            </li>
          </ul>
          <p className="r-body" style={bodyStyle}>
            Because our platform may rely on globally distributed tools,
            providers, or personnel, personal data may be processed or accessed
            in jurisdictions outside your country of residence. Where such
            transfers occur, we take reasonable steps designed to implement
            appropriate safeguards consistent with applicable data protection
            requirements, which may include contractual protections,
            confidentiality obligations, or other recognized transfer mechanisms
            where legally required.
          </p>
          <p className="r-body" style={bodyStyle}>
            Where applicable, including for users in jurisdictions with
            cross-border transfer restrictions such as the European Economic
            Area (EEA), we aim to use appropriate legal safeguards for
            international data transfers as required under relevant law.
          </p>

          <h3 style={h3Style}>Data retention period</h3>
          <p className="r-body" style={bodyStyle}>
            We will retain your personal data for as long as reasonably
            necessary to fulfil the purposes we collected it for, including
            providing and improving our services, your browsing experience,
            measure our audience, maintaining platform functionality, analyzing
            usage, supporting security, complying with legal obligations,
            resolving disputes, and enforcing our agreements. Retention periods
            may vary depending on the nature of the data, the purpose of
            processing, operational needs, and applicable legal requirements.
            Where permitted by law, you may request deletion of your personal
            data, subject to any legal, security, contractual, or legitimate
            business obligations that may require us to retain certain
            information.
          </p>

          <h3 style={h3Style}>Cookies</h3>
          <p className="r-body" style={bodyStyle}>
            We use cookies and similar technologies on our website to analyze
            traffic, improve functionality, and enhance the overall browsing
            experience for our visitors. Cookies are small text files placed on
            your device when you visit our website. Some cookies are necessary
            for the website to function properly, while others help us improve
            performance and personalize your experience. Cookies may also be
            used through trusted third-party services, such as Google Ads, to
            display advertisements that are more relevant to your interests.
            These advertisements may appear on our website or on other websites
            you visit. The use of cookies is limited to these purposes and is
            carried out in compliance with applicable data protection laws.
          </p>

          <h3 style={h3Style}>Social media credentials</h3>
          <p className="r-body" style={bodyStyle}>
            You may be able to connect to Relay website through social media
            platforms, programs or applications, such as Twitter, Google or
            Facebook or any other social media platform (“Social Media”), in
            which case we may collect your social media user name/ID, session
            key, timestamps and your user profile picture, URL (if applicable)
            provided by them, and list of friend/contact IDs etc.
          </p>

          <h3 style={h3Style}>Mailers</h3>
          <p className="r-body" style={bodyStyle}>
            Relay may, if you so choose, send direct mailers to you at the
            address given by you.
          </p>

          <h3 style={h3Style}>Anti-spam policy</h3>
          <p className="r-body" style={bodyStyle}>
            Relay identifies the receipt, transmission or distribution of spam
            emails as a major threat and concern and has taken reasonable
            measures to minimize its effect. All emails received by Relay are
            subject to spam check. Any email identified as spam will be
            rejected. Relay reserves the right to reject and/or report any
            suspicious spam emails, to the authorities concerned, for necessary
            action.
          </p>

          <h3 style={h3Style}>Link to other sites</h3>
          <p className="r-body" style={bodyStyle}>
            This website may contain links to other sites. We are not
            responsible for the privacy practices or the content of such
            websites.
          </p>

          <h3 style={h3Style}>Children’s privacy & age requirements</h3>
          <p className="r-body" style={bodyStyle}>
            Our website and services are not intended for individuals below the
            minimum age required under applicable law to consent to data
            processing in their jurisdiction. By using our website, you
            represent that you meet the applicable legal age requirement or have
            obtained valid parental or guardian consent where required. We do
            not knowingly collect personal data from individuals below the
            minimum age required by applicable law. If you become aware that
            someone under the applicable legal age is using our website or has
            provided personal data, please contact us, and we may take
            reasonable steps to review and delete such information where
            appropriate.
          </p>

          <h3 style={h3Style}>Your consent</h3>
          <p className="r-body" style={bodyStyle}>
            By using interacting with us via this website for our services, you
            give us consent to collect, use, and storage of your information in
            the manner described in this Privacy Policy. You may withdraw your
            consent at any time by contacting us at{" "}
            <a
              href="mailto:legal@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              legal@relay.green
            </a>
            . Please note that such withdrawal will not affect the lawfulness of
            any processing carried out prior to the withdrawal.
          </p>

          <h3 style={h3Style}>Changes to our privacy policy</h3>
          <p className="r-body" style={bodyStyle}>
            We may update this Privacy Policy and our use of cookies from time
            to time to reflect changes in our services, technology, business
            practices, or legal and regulatory requirements. Any updates will
            become effective upon posting the revised version on our website,
            unless otherwise required by applicable law. You are encouraged to
            review this page periodically to stay informed about how we collect,
            use, and protect your information. Your continued access to or use
            of the website after any updates are posted constitutes your
            acknowledgment of the revised policy.
          </p>

          <h3 style={h3Style}>Contact us</h3>
          <p className="r-body" style={bodyStyle}>
            For more information about our privacy practices, or if you have any
            questions, please contact us by email at{" "}
            <a
              href="mailto:legal@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              legal@relay.green
            </a>
            . To inquire about or report any personal data breach incident, you
            may contact us by email at{" "}
            <a
              href="mailto:dpo@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              dpo@relay.green
            </a>
            .
          </p>

          <div style={footerLineStyle}>
            Related policies:{" "}
            <Link
              href="/legal/cookies"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Cookies
            </Link>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
