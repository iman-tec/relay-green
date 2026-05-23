/*
 * /resources/customer-stories/two-person-marketing-team, Customer story.
 *
 * Server component. Customer write-up under the shared ArticleShell.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("customer-stories", "two-person-marketing-team")!;

export const metadata: Metadata = metadataForPost(post);

export default function CustomerStoryPage() {
  return (
    <ArticleShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="Not a freelancer.<br /><em>A person.</em>"
    >
      <Body>
        The team is two people. The company will go nameless at their request;
        for context, they sell vertical software to mid-market manufacturers,
        they&rsquo;re Series C, and the marketing function is two people because
        the rest of the org runs lean. In the fourth quarter of last year, they
        used Lovable, Bolt, and v0 to ship: a partner-portal microsite, a
        returns calculator, an A/B-test routing tool, a webinar registration
        backend, an internal taxonomy editor, six landing pages, four
        interactive demos, two sales-collateral generators, and three small
        internal dashboards. Twenty things. Most of them small. Some of them
        not.
      </Body>
      <Body>
        For ten of those twenty, they pressed for a Relay engineer. The other
        ten shipped without us. We asked them to talk us through the difference.
      </Body>
      <Pullquote>
        &ldquo;We never pressed when we were prototyping. We pressed when the
        prototype was about to meet a customer.&rdquo;
      </Pullquote>
      <Body>
        The pattern they described matches the four moments from the research
        above. The press almost always happened at one of three points: the day
        before a launch, the moment they tried to wire something to Salesforce
        or Marketo, or after the first time something went sideways in
        production. Sessions averaged just under an hour. The same engineer ,
        the marketing org&rsquo;s &ldquo;Relay person,&rdquo; in their words,
        picked up most of them, by the system&rsquo;s preference and theirs.
      </Body>
      <Body>
        What surprised us, and them, was the maintenance pattern. Eight of the
        ten tools they pressed for stayed in the relationship after launch , the
        engineer was paged when something broke, never more than once a week,
        usually less. They estimate they spent under $4,000 a month across the
        quarter and shipped what their COO called &ldquo;a year&rsquo;s worth of
        internal-tools work&rdquo; in three months.
      </Body>
      <Body>
        What we learned from running their account: software engineers, made
        available the moment a builder needs them, change the kind of work a
        non-engineering team is willing to attempt. They didn&rsquo;t ship more
        landing pages, they ship landing pages either way. They shipped harder
        things. The taxonomy editor was the one we were most surprised by;
        it&rsquo;s the kind of project that traditionally would have gone into
        the engineering backlog and never come out. Instead a marketing manager
        built it with Lovable, pressed twice, and it&rsquo;s now used by every
        department in the company.
      </Body>
      <Body>
        The thing the team said most often, in the writeup we did with them, was
        a version of: &ldquo;We didn&rsquo;t want a freelancer. We wanted a
        person.&rdquo; We think that&rsquo;s the line between this category and
        the previous one.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Customer name withheld at their request. Numbers verified by their
        finance team. Photos by Sasha Yip.
      </p>
    </ArticleShell>
  );
}
