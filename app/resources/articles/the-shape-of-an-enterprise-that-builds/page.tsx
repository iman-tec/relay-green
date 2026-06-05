/*
 * /resources/articles/the-shape-of-an-enterprise-that-builds, Essay.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "the-shape-of-an-enterprise-that-builds")!;

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
      ctaHeadlineHtml="The build has moved.<br /><em>Engineering moved with it.</em>"
    >
      <Body>
        Walk into the headquarters of a large American company in 1995 and the
        IT floor is the floor with the rooms. Servers behind glass. A nameplated
        team that owns the change-management calendar. Code is written there.
        Code is shipped from there. The rest of the building consumes what that
        floor produces.
      </Body>
      <Body>
        Walk in now. The IT floor still exists. It is still important. It is no
        longer where most of the company&rsquo;s software is written.
      </Body>
      <Pullquote>
        The center of gravity of building has moved off the engineering floor.
        Engineering knows. The shape of engineering is what is changing.
      </Pullquote>

      <Subhead>What we see, inside the Fortune 500</Subhead>
      <Body>
        Six of the ten enterprise customers we&rsquo;ve worked with over the
        last year now have an internal-tools function inside marketing. Five
        have one inside finance. Three have one inside legal. None of these
        functions existed two years ago. Each of them is staffed primarily by
        people whose job title does not contain the word <em>engineer</em>. Each
        of them ships software, into production, into the hands of internal
        users and sometimes external ones.
      </Body>
      <Body>
        At one of those customers, the marketing internal-tools function ships
        more software per quarter, by line and by deployed surface, than the
        marketing-technology team inside engineering does. The engineering team
        is not threatened by this. They architected it. They provided the rails,
        SSO, observability, the deployment pipeline, the secret store, the
        on-call rotation that catches what breaks. The engineering team does not
        write the software. They make sure the software written by everyone else
        is allowed to ship.
      </Body>

      <Subhead>The new shape of engineering</Subhead>
      <Body>
        Engineering, inside an enterprise that builds, is increasingly a
        platform. The platform team builds the rails. The platform team owns the
        press. When the marketing manager who built a tool with Lovable is about
        to send the URL to a customer, the platform team is the thing they reach
        for, through Relay, in our customers&rsquo; case, to confirm what they
        built will hold.
      </Body>
      <Body>
        Three things follow from that. First, the software engineer&rsquo;s job
        is denser, not lighter. They review more diffs, from more authors, in
        more domains, per week than they used to. Second, the company&rsquo;s
        engineering footprint expands rather than contracts. It expands in the
        direction of governance, not generation: review, observability,
        security, audit. Third, the failure mode of the new company is not
        bottleneck-at-engineering. It is <em>bottleneck-at-review.</em> The
        marketing manager has shipped the tool; engineering has not yet seen the
        tool; the tool is in production. This failure mode is what the press is
        for.
      </Body>

      <Subhead>What the org chart will look like in 2030</Subhead>
      <Body>
        We don&rsquo;t make precise predictions, but the rough shape is legible.
        A company of 10,000 employees in 2030 will have, by our estimate,
        between three and five times the number of distinct software systems in
        production it has today. Most of those systems will have been written by
        people not in engineering. The engineering team will be larger than
        today, not smaller, but it will be doing a different job. Engineering
        managers will manage review queues more than they manage authorship.
        Staff engineers will spend most of their day reading other
        people&rsquo;s code and saying <em>this can ship</em> or{" "}
        <em>this cannot.</em> Platform teams will outnumber feature teams.
      </Body>
      <Body>
        And the press, the moment a non-engineer asks a software engineer a
        single, time-boxed question about a single, time-boxed thing they have
        built, will be the smallest unit of work in the company. Smaller than a
        story. Smaller than a code review. Smaller than the meeting it would
        have replaced.
      </Body>

      <Subhead>What this means for buyers right now</Subhead>
      <Body>
        Three things, in the order we&rsquo;d weight them. One: invest in the
        rails. The rails are the difference between an enterprise that lets
        non-engineers build and an enterprise that has non-engineers shipping
        unsanctioned software through the back door. Two: invest in review
        capacity. Either inside, by repurposing software engineers from feature
        work to platform work, or outside, through services like ours. Three:
        write down what you are willing to let ship without an engineer in the
        room, and what you are not. The line is the policy. The press is the
        enforcement.
      </Body>

      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        The founders, May 2026.
      </p>
    </ArticleShell>
  );
}
