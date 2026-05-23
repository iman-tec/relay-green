/*
 * /resources/white-papers/hipaa-and-the-press, White paper.
 */

import type { Metadata } from "next";
import { WhitePaperShell } from "../../_components/WhitePaperShell";
import { Body } from "../../_components/Body";
import { Section } from "../../_components/Section";
import { Subhead } from "../../_components/Subhead";
import { Callout } from "../../_components/Callout";
import { DataTable } from "../../_components/DataTable";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("white-papers", "hipaa-and-the-press")!;

export const metadata: Metadata = metadataForPost(post);

const TOC = [
  { id: "context", label: "Why a healthcare-specific bench" },
  { id: "what-hipaa-asks", label: "What HIPAA actually asks of a service" },
  {
    id: "the-bench",
    label: "The bench: training, certification, segmentation",
  },
  { id: "the-session", label: "Inside the session: how PHI is handled" },
  { id: "the-record", label: "The record: what we keep, what we don't" },
  { id: "the-baa", label: "The BAA we sign, in plain English" },
  { id: "what-stays-out", label: "What we will not press for, by policy" },
  { id: "outcomes", label: "Outcomes from year one" },
];

export default function Page() {
  return (
    <WhitePaperShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="A press inside the perimeter.<br /><em>Cleanly.</em>"
      summary={{
        takeaway:
          "HIPAA-compliant on-demand engineering is a service-design problem, not a checkbox.",
        bullets: [
          "We operate a HIPAA-segmented bench: a smaller, dedicated set of engineers who have signed the additional agreements, completed the additional training, and are routed to all PHI-touching presses.",
          "We sign a Business Associate Agreement with every covered-entity customer; the BAA is not a back-office formality but the contract that defines who is responsible for what when something goes wrong.",
          "PHI never leaves the customer's environment in a Relay session. The engineer joins the customer's tooling; we don't pull data into ours.",
          "Sessions are recorded with consent and audit-graded; recordings live in the customer's account in our enterprise tier, or in a HIPAA-eligible cloud account we control under their BAA.",
          "We refuse some presses, by policy, because the safe answer is no. Roughly 4% of clinical-environment presses end with a refusal-to-ship recommendation rather than a shipped change.",
        ],
      }}
      toc={TOC}
      references={[
        {
          label: "U.S. HHS, HIPAA Security Rule (45 CFR §§ 164.302–318)",
          note: "Administrative, physical, and technical safeguards covered entities and business associates must implement.",
        },
        {
          label: "U.S. HHS, Business Associate Agreement Sample Provisions",
          note: "Reference set used as a starting point for our BAA template.",
        },
        {
          label: "NIST SP 800-66 Rev. 2, Implementing the HIPAA Security Rule",
          note: "Operational guidance we map our internal controls to.",
        },
        {
          label: "Relay, Trust center / HIPAA",
          href: "/trust/compliance",
          note: "Our public posture and current attestations.",
        },
        {
          label:
            "Relay, Industry essay: Healthcare-grade software in the age of the AI builder",
          href: "/resources/articles/healthcare-grade-software",
          note: "The why behind this paper, in shorter form.",
        },
      ]}
    >
      <Section
        id="context"
        eyebrow="01"
        heading="Why a healthcare-specific bench"
      >
        <Body>
          Relay&rsquo;s general-purpose bench serves builders across most
          industries from one substrate. Healthcare is the exception. The
          difference is not technical; the press technology is the same. The
          difference is regulatory. A press that touches Protected Health
          Information, or could plausibly touch it, lives inside a different
          contract envelope than every other press we run.
        </Body>
        <Body>
          We made the call early to operate a HIPAA-segmented bench rather than
          train every engineer to a healthcare bar. Three reasons. The first:
          training has to be specific to be useful, and a sub-bench can be
          trained more deeply than the entire bench could be. The second:
          routing is cleaner when the segmentation is structural, not
          procedural. The third: the additional cost of segmentation is smaller
          than the cost of a single privacy incident, by orders of magnitude.
        </Body>
        <Callout label="Scope of this paper">
          This is not legal advice. We document our operational choices and
          explain how they map to HIPAA&rsquo;s requirements. A covered entity
          considering Relay should still review with their privacy officer; the
          BAA we sign is the binding document.
        </Callout>
      </Section>

      <Section
        id="what-hipaa-asks"
        eyebrow="02"
        heading="What HIPAA actually asks of a service"
      >
        <Body>
          HIPAA is sometimes treated as a single rule. It isn&rsquo;t. The three
          pieces a business associate has to think about are the Privacy Rule,
          the Security Rule, and the Breach Notification Rule. The Privacy Rule
          defines what counts as PHI and the permitted uses. The Security Rule
          defines the administrative, physical, and technical safeguards. The
          Breach Notification Rule defines what to do when something goes wrong.
        </Body>
        <Subhead>The Security Rule, in three lists</Subhead>
        <Body>
          The Security Rule defines safeguards in three categories. We map our
          controls to each. Below is the public-facing summary; the full mapping
          is in our Trust center.
        </Body>
        <DataTable
          caption="Relay control families mapped to HIPAA Security Rule safeguards."
          headers={["Safeguard category", "Examples", "Relay controls"]}
          rows={[
            [
              "Administrative",
              "Workforce training, sanctions, access management",
              "HIPAA module in onboarding; quarterly refresh; sub-bench-only PHI access",
            ],
            [
              "Physical",
              "Facility access, workstation security, device & media controls",
              "Cloud-only operations; locked corp devices; remote-wipe enforced",
            ],
            [
              "Technical",
              "Access control, audit, integrity, transmission security",
              "Per-session SSO; full session audit; signed-record integrity; TLS 1.3 throughout",
            ],
          ]}
        />
      </Section>

      <Section
        id="the-bench"
        eyebrow="03"
        heading="The bench: training, certification, segmentation"
      >
        <Body>
          The HIPAA-segmented bench is a subset of our general bench. To join
          it, an engineer signs the additional agreements, completes the
          additional training, and is added to the routing tag that
          health-touching presses route to.
        </Body>
        <Subhead>What the additional training covers</Subhead>
        <Body>
          The training is six modules of roughly forty minutes each. The first
          two are HIPAA fundamentals: what counts as PHI, who is covered, what
          permitted uses look like. The next two are operational: how to
          recognize PHI in a customer session, what to do if PHI surfaces
          unexpectedly, when to pause a session for a privacy review. The final
          two are technical: defensible architecture patterns for clinical
          workflows, common AI-build failure modes (over-sharing identifiers,
          weak boundary discipline, log-fields-as-PHI mistakes).
        </Body>
        <Body>
          We refresh the curriculum quarterly. The refresh is mandatory; a
          sub-bench engineer who lapses on training is removed from the routing
          tag automatically and reinstated on completion.
        </Body>
        <Subhead>How segmentation works at routing time</Subhead>
        <Body>
          Every customer account is flagged at signup with a PHI-likely /
          PHI-not-likely tag. Customers in regulated industries self-declare;
          the flag is tightened during the BAA conversation if signed. A press
          from a flagged account routes only to the sub-bench. The router
          enforces this at the route step, not at the engineer&rsquo;s
          discretion. An engineer outside the sub-bench cannot, by construction,
          be assigned a PHI press.
        </Body>
      </Section>

      <Section
        id="the-session"
        eyebrow="04"
        heading="Inside the session: how PHI is handled"
      >
        <Body>
          The default posture is: PHI does not leave the customer&rsquo;s
          environment. The engineer joins the customer&rsquo;s tooling , their
          IDE, their staging environment, their database console with the
          engineer&rsquo;s read access scoped to the minimum required , and
          works there. We do not pull data into our own systems. We do not paste
          PHI into shared chat. We do not copy fields out of the session into
          our own notes.
        </Body>
        <Subhead>What the engineer can see, by stack</Subhead>
        <Body>
          A typical clinical-operations stack, an EHR-adjacent internal tool,
          say, gives the engineer read-only access to a sandbox that has been
          scrubbed of PHI by the customer. If the sandbox cannot be scrubbed
          (the bug only reproduces against real data), we move the session to a
          screen-share posture: the engineer guides; the customer drives; PHI
          never leaves the customer&rsquo;s screen.
        </Body>
        <Subhead>What we do when PHI surfaces unexpectedly</Subhead>
        <Body>
          The protocol is short. Pause. Tell the customer what surfaced. Decide
          together whether the session can continue, or whether we need to
          escalate to a privacy review. Document the moment. The
          customer&rsquo;s privacy officer is the decider; we are the flagger.
        </Body>
        <Callout label="What we never do" tone="green">
          Paste customer data into a third-party LLM, even for &ldquo;just to
          ask.&rdquo; Take a screenshot that includes a patient identifier.
          Remember a fact about a real patient between sessions. Operate against
          production data without an explicit customer instruction in the
          session record.
        </Callout>
      </Section>

      <Section
        id="the-record"
        eyebrow="05"
        heading="The record: what we keep, what we don't"
      >
        <Body>
          Every Relay session is recorded with consent, chat transcript, screen,
          and the changes made. For HIPAA-flagged accounts the record is held
          differently than for general accounts. Two options the customer
          chooses between at BAA signing.
        </Body>
        <Subhead>Option A: customer-tenanted record</Subhead>
        <Body>
          The record is stored in the customer&rsquo;s own cloud account, via
          their own KMS key, with us as a service-account writer. We can read
          the record we wrote, when we are inside an active session. We cannot
          read it after the session ends without an access request that the
          customer logs. This is the posture most enterprise covered entities
          choose.
        </Body>
        <Subhead>Option B: Relay-held HIPAA-eligible record</Subhead>
        <Body>
          The record is stored in our HIPAA-eligible cloud account, under the
          BAA. Encryption at rest with per-customer keys. Strict retention
          (default 18 months, customer-configurable). Audit log of every
          internal access. This is the posture smaller covered entities choose,
          because it does not require them to operate a HIPAA-eligible cloud
          account themselves.
        </Body>
      </Section>

      <Section
        id="the-baa"
        eyebrow="06"
        heading="The BAA we sign, in plain English"
      >
        <Body>
          The BAA is a contract between the covered entity and Relay as business
          associate. Six things it says, in plain language.
        </Body>
        <Body>
          <b>One.</b> We use PHI only for the permitted purposes, which is to
          provide the engineering services the customer has asked for, and
          nothing else. <b>Two.</b> We have safeguards in place. <b>Three.</b>{" "}
          We will tell the customer if we discover a breach, within the
          timeframes HIPAA defines. <b>Four.</b> We will help the customer with
          their own obligations, providing access, accounting for disclosures,
          supplying documentation. <b>Five.</b> We will return or destroy the
          PHI when the relationship ends. <b>Six.</b> We are responsible for our
          subcontractors as if their actions were ours, and they sign flow-down
          agreements that match.
        </Body>
        <Body>
          The full text is a few pages and the customer&rsquo;s privacy officer
          should read it. We send it on request.
        </Body>
      </Section>

      <Section
        id="what-stays-out"
        eyebrow="07"
        heading="What we will not press for, by policy"
      >
        <Body>
          Some presses we decline to take, in advance. We document them here so
          customers know before they need to.
        </Body>
        <Body>
          We do not press for clinical-decision-support code paths that will be
          deployed without separate clinical sign-off. We do not press for
          patient-facing software that bypasses the customer&rsquo;s identity
          stack. We do not press for changes to consent-capture flows that have
          not been approved by the customer&rsquo;s privacy officer. We do not
          press for direct modification of clinical records. We do not press for
          anything regulated as a medical device under FDA jurisdiction unless
          the customer has a quality-management system and we are working inside
          it.
        </Body>
        <Body>
          The line is not <em>we cannot help</em>. The line is{" "}
          <em>this press needs people who are not us in the room.</em> We will
          recommend partners.
        </Body>
      </Section>

      <Section id="outcomes" eyebrow="08" heading="Outcomes from year one">
        <Body>
          We ran 1,140 healthcare presses in our first twelve months across
          thirty-one covered-entity customers. Selected outcomes, aggregated:
        </Body>
        <DataTable
          caption="Healthcare-segmented bench outcomes, 2025-2026."
          headers={["Metric", "Value", "Notes"]}
          rows={[
            ["Total presses", "1,140", "Across 31 customers"],
            ["Resolution rate", "93%", "Excludes customer-cancelled"],
            [
              "Refused-to-ship rate",
              "4.0%",
              "Engineer recommended against shipping",
            ],
            [
              "Median session length",
              "38 min",
              "Longer than non-clinical bench",
            ],
            ["Privacy-pause events", "11", "All resolved without breach"],
            ["Reportable breaches", "0", "Through May 2026"],
          ]}
        />
        <Body>
          Two patterns are worth highlighting. The refused-to-ship rate is
          meaningfully higher than our general bench (which sits below 1%). That
          is the sub-bench doing its job. The privacy-pause rate, eleven events
          in 1,140 sessions, is the rate at which something surfaces in-session
          that requires a beat. None of those events became a breach, because
          the pause worked. We treat that as the right number; zero would
          suggest we&rsquo;re not pausing often enough.
        </Body>
      </Section>
    </WhitePaperShell>
  );
}
