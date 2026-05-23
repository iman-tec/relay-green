/*
 * /resources/articles/healthcare-grade-software, Industry essay.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "healthcare-grade-software")!;

export const metadata: Metadata = metadataForPost(post);

export default function Page() {
  return (
    <ArticleShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="Healthcare-grade builds.<br /><em>A press that knows the rules.</em>"
    >
      <Body>
        Most software domains have an evidence bar that bends. The product
        manager wants the feature; the engineering manager pushes back; a
        compromise ships; users complain or they don&rsquo;t. Healthcare is not
        most domains. Clinical-grade software has an evidence bar that was set
        by the FDA, by HIPAA, by twenty years of harm-avoidance case law, and by
        the working memory of every clinician who has ever watched a tool fail
        at the wrong moment. The bar does not bend.
      </Body>
      <Body>
        Which is why the AI-builder revolution is going to look strange in
        healthcare for a while. The marketing manager who can ship a
        partner-portal microsite cannot, in a regulated environment, ship an
        intake form that touches PHI. The clinician who can prototype an
        appointment-routing tool cannot ship the tool to actual patients without
        somebody licensed and auditable in the loop. The same speed that
        compresses a quarter into a Tuesday in marketing compresses nothing in
        healthcare, because the slow part is not the writing. The slow part is
        the assurance.
      </Body>
      <Pullquote>
        In healthcare, the question isn&rsquo;t can the AI build it. The
        question is who is willing to sign that the build is safe to use.
      </Pullquote>

      <Subhead>What healthcare-grade actually requires</Subhead>
      <Body>
        Three things, in rough order of how often we see them missed by AI-built
        first drafts.
      </Body>
      <Body>
        <b>Provenance.</b> Healthcare audit trails are not log files. They are
        evidence in a possible future investigation. Every change to a patient
        record, every decision support recommendation, every identity
        verification, every consent capture, the system has to be able to
        reconstruct what happened, who saw it, what they did, and why. AI-built
        software is bad at provenance by default; it treats logs as a debugging
        tool, not a legal artifact. Closing that gap is most of what a Relay
        engineer does on a healthcare press.
      </Body>
      <Body>
        <b>Boundary discipline.</b> PHI does not belong on every server.
        Healthcare-grade architecture pushes PHI to the smallest perimeter
        possible and treats every crossing of that perimeter as a controlled
        act. AI-built first drafts often cheerfully copy identifiers across
        services in ways that would never pass a compliance review. The fix is
        rarely a rewrite. It&rsquo;s a refactor at the boundaries: a
        tokenization layer here, a redaction proxy there, a deliberate set of
        read-only views for the AI to operate on.
      </Body>
      <Body>
        <b>Failure semantics.</b> When the system can&rsquo;t respond, what does
        it do? In a marketing tool, the answer is &ldquo;show an error and try
        again later.&rdquo; In a clinical tool, the answer depends on the
        clinical context: sometimes degrade gracefully, sometimes refuse,
        sometimes escalate to a human. AI-built first drafts collapse all of
        these into the same retry loop. Picking the right failure mode for each
        clinical pathway is, again, a software engineer&rsquo;s job, not a
        generation problem.
      </Body>

      <Subhead>What we&rsquo;ve seen, in our healthcare presses</Subhead>
      <Body>
        We won&rsquo;t name customers; HIPAA constraints are tighter than the
        marketing-team constraints we wrote about elsewhere. But the patterns
        are stable across the dozens of healthcare presses we&rsquo;ve run.
      </Body>
      <Body>
        Most healthcare presses are not, in their first sentence, about
        healthcare. They are about a deployment problem, an integration problem,
        an authentication problem. The PHI dimension surfaces in minute four
        when the engineer asks what data the form will capture, and the customer
        says <em>oh, names and DOB and the insurance member ID.</em> At that
        moment the press becomes a different kind of press. The engineer&rsquo;s
        job is no longer to ship the form. The engineer&rsquo;s job is to either
        move the form into the regulated perimeter, with the right architecture,
        or to tell the customer the form cannot ship in this shape. We say the
        second one more often than people expect.
      </Body>

      <Subhead>What this means for builders inside health systems</Subhead>
      <Body>
        Two things. First: build prototypes. The AI tools that have changed
        marketing have changed clinical operations too, and a
        clinical-operations lead with Lovable can ship internal-facing tools
        faster than the IT department ever could. The boundary, as always, is
        when the prototype meets a patient. Build to that line; press at that
        line.
      </Body>
      <Body>
        Second: do not let the prototype meet the patient without a senior
        engineer who has shipped clinical software before. A marketing prototype
        that ships in a broken state is embarrassing. A clinical prototype that
        ships in a broken state can hurt a patient and end a career. The press
        exists, in healthcare, primarily to enforce that line.
      </Body>
      <Body>
        We are publishing a longer white paper on the specific infrastructure of
        HIPAA-compliant Relay sessions, how we train, how we segment the bench,
        what BAAs cover, how PHI is handled inside the session itself. This
        essay is the why; the white paper is the how.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Industry essay. Reviewed by our compliance counsel for accuracy on the
        regulatory points; the opinions are ours.
      </p>
    </ArticleShell>
  );
}
