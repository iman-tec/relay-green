/*
 * /resources/white-papers/compliance-architecture-for-ai-built-software, White paper.
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

const post = findPost(
  "white-papers",
  "compliance-architecture-for-ai-built-software"
)!;

export const metadata: Metadata = metadataForPost(post);

const TOC = [
  {
    id: "premise",
    label: "The premise: most code is not written by your engineers",
  },
  { id: "what-changes", label: "What this changes about compliance" },
  { id: "soc2", label: "SOC 2 in an AI-build company" },
  { id: "iso", label: "ISO 27001 / 27701 in an AI-build company" },
  { id: "audit-trail", label: "The sessioned record as audit artifact" },
  { id: "data-flows", label: "Data flows across the build perimeter" },
  { id: "policy", label: "Policy controls: what to write down" },
  { id: "tooling", label: "Tooling: what to actually deploy" },
  { id: "checklist", label: "A 30-day compliance retrofit" },
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
      ctaHeadlineHtml="Compliant by design.<br /><em>Not by checklist.</em>"
      summary={{
        takeaway:
          "When most of your software is written by builders who aren't engineers, your compliance program has to be designed for that, not retrofitted to it.",
        bullets: [
          "The traditional control narrative, engineers write code, the engineering team owns review, audits trace through commits, fails when half your shipped surface is written outside engineering.",
          "Three controls do most of the work in the new posture: a sessioned record of every assisted build, a deliberate boundary between AI-tool environments and production, and a written policy on what cannot ship without an engineer.",
          "SOC 2 and ISO 27001 do not need to be reinvented. They need to be reframed: the press becomes a control, the sessioned record becomes the audit trail, and platform engineering becomes the operator of both.",
          "The cost of doing this poorly is measured in audit findings; the cost of not doing it is measured in incidents.",
        ],
      }}
      toc={TOC}
      references={[
        {
          label: "AICPA, Trust Services Criteria (TSC) for SOC 2",
          note: "The criteria SOC 2 reports against. Read TSC §§ CC6, CC7, CC8 first.",
        },
        {
          label: "ISO/IEC 27001:2022, Information security management systems",
          note: "Annex A controls; especially A.5 (organizational), A.8 (technological).",
        },
        {
          label: "ISO/IEC 27701:2019, Privacy information management",
          note: "PIMS extension. Where SOC 2 + ISO 27001 meet GDPR.",
        },
        {
          label: "NIST SP 800-218, Secure Software Development Framework",
          note: "Useful crosswalk for AI-assisted development practices.",
        },
        {
          label: "Relay, White paper: HIPAA and the press",
          href: "/resources/white-papers/hipaa-and-the-press",
          note: "Companion paper: the same framework applied to PHI.",
        },
      ]}
    >
      <Section
        id="premise"
        eyebrow="01"
        heading="The premise: most code is not written by your engineers"
      >
        <Body>
          Three years ago this paper would have started by listing the AI tools
          changing software development. Today the assumption is ambient. Your
          marketing team has Lovable. Your operations team has Bolt. Your
          engineering team has Claude and Cursor. Every department in the
          company is now, in some measure, a software department. Most of the
          code being written in your company is not being written by your
          engineers.
        </Body>
        <Body>
          This is the premise of this paper, and the premise the compliance
          program has to absorb. The traditional shape of an information
          security program assumes that code originates inside engineering, is
          reviewed inside engineering, and is shipped inside engineering. None
          of these are true now in the way they were five years ago.
        </Body>
      </Section>

      <Section
        id="what-changes"
        eyebrow="02"
        heading="What this changes about compliance"
      >
        <Body>
          Five things, in rough order of how often we see them surface in
          conversations with CISOs.
        </Body>
        <Subhead>Provenance moves out of git</Subhead>
        <Body>
          The traditional audit trail starts in git: every change to production
          has a commit, an author, a review. That trail assumes the change
          originated as a commit. AI-assisted builds often originate in a chat
          session, become a generated artifact, get pushed to a deployment
          platform, and never see the inside of the org&rsquo;s primary git
          infrastructure. The audit trail either has to follow the build to the
          new platforms, or the build has to be required to come back to the
          canonical infrastructure before shipping.
        </Body>
        <Subhead>The reviewer is no longer the author&rsquo;s peer</Subhead>
        <Body>
          A software engineer reviewing a junior engineer&rsquo;s diff shares a
          lot of context. A software engineer reviewing a marketing
          manager&rsquo;s AI-generated diff shares almost none. The review
          function still works, but the reviewer is now carrying more of the
          load, what would have been implicit author understanding is now
          explicit reviewer work.
        </Body>
        <Subhead>Boundary discipline becomes the control</Subhead>
        <Body>
          Where production data is allowed to live, where AI-tool environments
          are allowed to reach, and what crosses the line between the two are
          now first-order compliance questions. In practice this is the question
          that determines whether an AI build can ever serve customers safely.
        </Body>
        <Subhead>The supply chain expands</Subhead>
        <Body>
          Every AI builder your company uses is, technically, a sub- processor
          in your privacy program if any data flows through it. The supply chain
          expanded. The vendor inventory expanded with it. So did the work to
          maintain DPAs and sub-processor lists.
        </Body>
        <Subhead>The audit becomes a sampling problem</Subhead>
        <Body>
          Auditors used to sample commits. They now have to sample sessions. The
          unit of evidence for an SOC 2 review, in our posture, is the session
          record, what was built, who was in the room, what was approved.
        </Body>
      </Section>

      <Section id="soc2" eyebrow="03" heading="SOC 2 in an AI-build company">
        <Body>
          The Trust Services Criteria do not need to be replaced. They need to
          be reframed. Three areas where the framing shifts most.
        </Body>
        <Subhead>CC6, Logical and physical access</Subhead>
        <Body>
          The control objective is the same: the right people have the right
          access to the right systems. What changes is the surface. AI-tool
          environments have to be in scope. The marketing manager&rsquo;s
          Lovable account that ships to production is, by construction, in
          scope. The line is not <em>this is not an engineering tool</em>. The
          line is{" "}
          <em>does this tool produce code that runs against company data?</em>
        </Body>
        <Subhead>CC7, Operations and monitoring</Subhead>
        <Body>
          Logging the production system is necessary and not sufficient. The
          build process, including the AI session that generated the build, has
          to be loggable enough that an incident investigator can trace from a
          production failure back to the moment a particular line was generated,
          by which tool, and accepted by whom. This is hard. It is also where
          the sessioned record (CC7&rsquo;s most important evidence in the new
          posture) does most of its work.
        </Body>
        <Subhead>CC8, Change management</Subhead>
        <Body>
          A change-management policy that was written for engineers committing
          to git does not survive contact with marketing managers deploying via
          Vercel. The policy has to specify what counts as a change, what the
          review path is, and what the ship-without-engineer-allowed surface is.
          We provide a template at the end of this paper.
        </Body>
        <Callout label="What auditors will ask for first">
          A list of every system that can produce code shipping to production,
          and the human review attached to each. Have it ready. Build it before
          the auditor asks.
        </Callout>
      </Section>

      <Section
        id="iso"
        eyebrow="04"
        heading="ISO 27001 / 27701 in an AI-build company"
      >
        <Body>
          ISO 27001:2022 added explicit controls for information security in
          development (A.8.25-A.8.31). They are the cleanest starting point we
          have seen for the AI-build environment. A.8.25 covers secure
          development life cycle. A.8.27 covers secure system architecture.
          A.8.28 covers secure coding. Each of these reads, in 2026, like it was
          written with AI builders in mind, even though it wasn&rsquo;t.
        </Body>
        <Body>
          ISO 27701, the privacy extension, becomes load-bearing once any AI
          tool processes personal data. Sub-processor management, retention,
          data subject rights all extend to the AI vendors your non-engineering
          teams have chosen. Most companies have significantly more 27701
          sub-processors than they realize.
        </Body>
      </Section>

      <Section
        id="audit-trail"
        eyebrow="05"
        heading="The sessioned record as audit artifact"
      >
        <Body>
          The single most important architectural decision in the new posture is
          what becomes the system of record for builds. Three things have to be
          true of whatever you choose. It has to capture the AI session that
          produced the build. It has to capture the human review that approved
          the build. It has to be retained, integrity-preserved, and produceable
          on auditor request.
        </Body>
        <Subhead>What we have seen work</Subhead>
        <Body>
          Two patterns. <b>Pattern A:</b> a centralized engineering log that
          ingests AI-tool transcripts via API, attaches review decisions from a
          workflow tool, and indexes both. Works for companies with the
          engineering bandwidth to build it. <b>Pattern B:</b> a service
          relationship (us, in our customers&rsquo; case, but not necessarily
          us) that records every AI-build assistance session under a
          service-level recording obligation, with customer-tenanted retention.
          Works for companies that don&rsquo;t want to build their own pipeline.
        </Body>
      </Section>

      <Section
        id="data-flows"
        eyebrow="06"
        heading="Data flows across the build perimeter"
      >
        <Body>
          Map them. Every CISO we have worked with in the last year has
          discovered, on doing this, that production data is reaching AI-tool
          environments their security program did not know about. The maps are
          usually not pretty. The fix is rarely a rip-and-replace. It is a
          perimeter reset.
        </Body>
        <Subhead>The three perimeters worth drawing explicitly</Subhead>
        <Body>
          <b>The production perimeter.</b> What systems can read customer data.{" "}
          <b>The build perimeter.</b> What systems can produce code that runs
          against the production perimeter. <b>The tool perimeter.</b> What
          systems can be reached from inside the build perimeter. The compliance
          question is whether the three are stacked the way you think they are.
        </Body>
        <DataTable
          caption="Common build-perimeter findings, across customers."
          headers={["Finding", "Frequency", "Severity"]}
          rows={[
            [
              "AI tool with production read access via copied secrets",
              "High",
              "Critical",
            ],
            ["Generated code deployed without human review", "High", "High"],
            [
              "AI-tool DPA missing or sub-processor not listed",
              "Medium",
              "Medium",
            ],
            ["Production data pasted into LLM chat, ad hoc", "Medium", "High"],
            [
              "AI-tool retention exceeds company retention policy",
              "Medium",
              "Medium",
            ],
          ]}
        />
      </Section>

      <Section
        id="policy"
        eyebrow="07"
        heading="Policy controls: what to write down"
      >
        <Body>The three documents we recommend writing first.</Body>
        <Subhead>The AI-build acceptable use policy</Subhead>
        <Body>
          Specifies which AI tools are approved, which data classes can be sent
          to which tools, what review is required before what kind of build can
          ship. One page; concrete; named tools. Not a procurement document.
        </Body>
        <Subhead>The shipping-without-engineering policy</Subhead>
        <Body>
          Specifies what surfaces non-engineers are allowed to ship to without a
          software engineer in the room. The complement also matters: surfaces
          where they cannot. Specific. Production customer data, identity,
          payments, regulated workflows: never. Internal-only marketing tools,
          public-facing static sites, analytics dashboards reading approved
          sources: yes.
        </Body>
        <Subhead>The session-record policy</Subhead>
        <Body>
          Specifies what is recorded, retained, and produced on request. Where
          it lives. Who can read it. Who is alerted when someone reads it. The
          auditor will read this document first.
        </Body>
      </Section>

      <Section
        id="tooling"
        eyebrow="08"
        heading="Tooling: what to actually deploy"
      >
        <Body>
          Order of operations. The first three are unconditionally worth doing.
        </Body>
        <Body>
          <b>1. SSO every AI tool.</b> If your marketing manager logs into
          Lovable with their personal Gmail, you have a deprovisioning problem
          and a sub-processor problem. SSO closes both.
        </Body>
        <Body>
          <b>2. Centralize secret management.</b> AI tools are good at asking
          for credentials and bad at handling them. A vault that mediates is the
          difference between a leak and a near-miss.
        </Body>
        <Body>
          <b>3. Mediate the deploy step.</b> Every shipping path goes through
          the same review surface, even if the build originated outside
          engineering. The press, in our terms, is the review surface. Yours
          might be a workflow tool, a CI pipeline gate, or a ticket. Pick one
          and make it mandatory.
        </Body>
      </Section>

      <Section
        id="checklist"
        eyebrow="09"
        heading="A 30-day compliance retrofit"
      >
        <Body>
          For companies starting from zero. Each item is a working day, give or
          take.
        </Body>
        <Body>
          <b>Week 1.</b> Inventory: list every AI builder in use, by team, with
          screenshots of what they ship to. Map data flows. Identify the worst
          three.
        </Body>
        <Body>
          <b>Week 2.</b> SSO and secrets: enroll the tools in SSO, rotate
          credentials that have lived in screenshots and chats, centralize the
          vault.
        </Body>
        <Body>
          <b>Week 3.</b> Policy: draft the three documents above. Have legal
          review. Have engineering review. Get the CEO to sign.
        </Body>
        <Body>
          <b>Week 4.</b> Mediated deploy: pick one shipping surface (start with
          the highest-volume non-engineer team). Wire it through a review gate.
          Roll out to the second team in week five.
        </Body>
        <Callout label="What we will and won't help with">
          Relay can be the review gate at the deploy step, by press. We cannot
          be your CISO. The policy work, the vendor mapping, the board
          conversation, those are yours. We will sit in the press when the
          buyer-built code is about to ship and stop the things that should not.
        </Callout>
      </Section>
    </WhitePaperShell>
  );
}
