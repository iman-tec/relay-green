/*
 * /resources/research/when-does-an-ai-build-want-a-person, Research.
 *
 * Server component. Sub-headed research write-up under the shared
 * ArticleShell.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("research", "when-does-an-ai-build-want-a-person")!;

export const metadata: Metadata = metadataForPost(post);

export default function ResearchPage() {
  return (
    <ArticleShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="Four moments.<br /><em>One press.</em>"
    >
      <Body>
        Between February and April 2026, beta customers pressed for an engineer
        4,217 times. Each press is a moment a person building software with an
        AI decided that the next step was easier with a human in the room. We
        labeled every session by what happened in the seconds before the press,
        and again by what happened in the thirty minutes after. Four categories
        cover 92% of the sample.
      </Body>

      <Subhead>One. The confidence wall (38%)</Subhead>
      <Body>
        The build technically works. The builder has clicked through it ten
        times. They cannot bring themselves to ship it because they do not know
        if it will hold. They press for a person who will read it once and
        answer one question: <em>can I send this to a customer?</em> Average
        session length: 14 minutes. Resolution rate: 96%.
      </Body>

      <Subhead>Two. The integration cliff (29%)</Subhead>
      <Body>
        The AI produced a complete, runnable artifact. Connecting it to anything
        outside the sandbox, a database, an auth provider, a payment gateway, an
        email service, fails repeatedly in non-obvious ways. The builder
        presses. Average session length: 41 minutes. Resolution rate: 89%.
      </Body>

      <Subhead>Three. The deploy moment (17%)</Subhead>
      <Body>
        The build runs locally. The builder has a domain. They have not deployed
        software before. They press because the gap between &ldquo;works on my
        machine&rdquo; and &ldquo;works in production&rdquo; turns out to be
        most of the work. Average session length: 1h 12min. Resolution rate:
        94%.
      </Body>

      <Subhead>Four. The ownership question (8%)</Subhead>
      <Body>
        The build is shipped. Something has changed in the world, a payment
        failed, a user reported a bug, a third-party API silently changed shape.
        The builder presses because the build has stopped being a build and
        started being a system, and systems want a person to own them.
        Resolution rate: 99%; mean-time-to-resolve: 23 minutes; relationships
        continued: 71%.
      </Body>

      <Subhead>The 8% that doesn&rsquo;t fit</Subhead>
      <Body>
        About one in twelve presses we couldn&rsquo;t cleanly classify.
        They&rsquo;re mostly conversations. The build is fine; the builder wants
        a second opinion on a decision that isn&rsquo;t really a code decision
        (a vendor, an architecture choice, whether to rewrite). We think this is
        its own category and will keep watching it.
      </Body>

      <Body>
        The takeaway, for us, is that the press isn&rsquo;t random. It clusters
        around four legible moments, and the fastest path to making AI builds
        reliable is to make the press cheap, instant, and obvious at exactly
        those four moments. That&rsquo;s the design of the desktop, and
        increasingly the design of every integration.
      </Body>

      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Relay Research, with help from the engineering team. Anonymized,
        aggregated. Methodology note available on request.
      </p>
    </ArticleShell>
  );
}
