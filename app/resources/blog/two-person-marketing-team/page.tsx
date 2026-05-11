/*
 * /resources/blog/two-person-marketing-team — Customer story.
 *
 * Server component. Customer write-up under the marketing Shell.
 */

import type { Metadata } from "next";
import { Shell } from "../../../_marketing/Shell";
import { TryRelayButton } from "../../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title:
    "Relay — A two-person marketing team. Twenty internal tools. One engineer on call.",
  description:
    "How a growth team at a mid-market SaaS company shipped a quarter of internal tools without filing a single ticket to engineering.",
};

const bodyStyle = {
  fontSize: 16,
  lineHeight: 1.65,
  marginBottom: 14,
  maxWidth: "62ch",
} as const;

const blockquoteStyle = {
  borderLeft: "3px solid var(--green)",
  padding: "8px 0 8px 24px",
  margin: "24px 0",
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: 20,
  maxWidth: "56ch",
} as const;

export default function CustomerStoryPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Customer story · April 2026 · 6 min read</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Two-person team.
            <br />
            <em>Twenty internal tools.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            How a growth team at a mid-market SaaS company shipped a quarter
            of internal tools without filing a single ticket to engineering.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <article>
            <p className="r-body" style={bodyStyle}>
              The team is two people. The company will go nameless at their
              request; for context, they sell vertical software to mid-market
              manufacturers, they&rsquo;re Series C, and the marketing
              function is two people because the rest of the org runs lean.
              In the fourth quarter of last year, they used Lovable, Bolt,
              and v0 to ship: a partner-portal microsite, a returns
              calculator, an A/B-test routing tool, a webinar registration
              backend, an internal taxonomy editor, six landing pages, four
              interactive demos, two sales-collateral generators, and three
              small internal dashboards. Twenty things. Most of them small.
              Some of them not.
            </p>
            <p className="r-body" style={bodyStyle}>
              For ten of those twenty, they pressed for a Relay engineer. The
              other ten shipped without us. We asked them to talk us through
              the difference.
            </p>
            <blockquote style={blockquoteStyle}>
              &ldquo;We never pressed when we were prototyping. We pressed
              when the prototype was about to meet a customer.&rdquo;
            </blockquote>
            <p className="r-body" style={bodyStyle}>
              The pattern they described matches the four moments from the
              research above. The press almost always happened at one of
              three points: the day before a launch, the moment they tried to
              wire something to Salesforce or Marketo, or after the first
              time something went sideways in production. Sessions averaged
              just under an hour. The same engineer &mdash; the marketing
              org&rsquo;s &ldquo;Relay person,&rdquo; in their words &mdash;
              picked up most of them, by the system&rsquo;s preference and
              theirs.
            </p>
            <p className="r-body" style={bodyStyle}>
              What surprised us, and them, was the maintenance pattern. Eight
              of the ten tools they pressed for stayed in the relationship
              after launch &mdash; the engineer was paged when something
              broke, never more than once a week, usually less. They estimate
              they spent under $4,000 a month across the quarter and shipped
              what their COO called &ldquo;a year&rsquo;s worth of
              internal-tools work&rdquo; in three months.
            </p>
            <p className="r-body" style={bodyStyle}>
              What we learned from running their account: senior engineers,
              made available the moment a builder needs them, change the kind
              of work a non-engineering team is willing to attempt. They
              didn&rsquo;t ship more landing pages &mdash; they ship landing
              pages either way. They shipped harder things. The taxonomy
              editor was the one we were most surprised by; it&rsquo;s the
              kind of project that traditionally would have gone into the
              engineering backlog and never come out. Instead a marketing
              manager built it with Lovable, pressed twice, and it&rsquo;s
              now used by every department in the company.
            </p>
            <p className="r-body" style={bodyStyle}>
              The thing the team said most often, in the writeup we did with
              them, was a version of: &ldquo;We didn&rsquo;t want a
              freelancer. We wanted a person.&rdquo; We think that&rsquo;s
              the line between this category and the previous one.
            </p>
            <p
              style={{
                fontStyle: "italic",
                color: "var(--ink-mute)",
                fontSize: 14,
                marginTop: 32,
              }}
            >
              &mdash; Customer name withheld at their request. Numbers
              verified by their finance team. Photos by Sasha Yip.
            </p>
          </article>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Not a freelancer.
            <br />
            <em>A person.</em>
          </h2>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <TryRelayButton />
          </div>
        </div>
      </section>
    </Shell>
  );
}
