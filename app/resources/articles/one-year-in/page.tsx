/*
 * /resources/articles/one-year-in, Anniversary essay.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "one-year-in")!;

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
      ctaHeadlineHtml="The dot has been green<br /><em>for a year.</em>"
    >
      <Body>
        We started this company a year ago this week. We had a hypothesis: AI
        was going to make most builders into people who could not, on their own,
        ship the thing they had built; a software engineer one click away was
        the missing piece; the press, as a category, would emerge whether we
        built it or somebody else did.
      </Body>
      <Body>
        A year in, three things turned out as expected. Three turned out
        differently. One we got wrong about how the work would feel.
      </Body>

      <Subhead>What turned out as expected</Subhead>
      <Body>
        <b>The press is the unit.</b> Customers do not want a contract, or a
        retainer, or a freelancer rotation. They want the green dot. They want
        it now. Volume per customer is higher than we modeled; ARPU compounds
        with usage faster than we expected because every press is a positive
        proof point that triggers another. The product is the right shape.
      </Body>
      <Body>
        <b>The bench scales.</b> We worried about hiring software engineers fast
        enough. The bench is bigger than we predicted at this milestone, and the
        hire-to-bar ratio has held. We are not bottlenecked on engineers. We are
        bottlenecked on integrations.
      </Body>
      <Body>
        <b>Customers stay.</b> Our churn is lower than every comparable B2B
        services company we benchmarked against. The relationship the product
        creates, the same engineer, across phases, is a retention mechanism we
        under-weighted in the model.
      </Body>

      <Subhead>What turned out differently</Subhead>
      <Body>
        <b>The customer isn&rsquo;t who we thought.</b> We expected the product
        to be discovered by individual builders inside small companies. The
        first six months were the opposite: enterprise teams with internal-tools
        functions, mid-market growth teams, clinical-operations groups inside
        health systems. The non-engineering builder inside a large company
        turned out to be the beachhead, not the indie hacker. We rebuilt our
        messaging around that and shipped <em>For Enterprise</em> earlier than
        planned.
      </Body>
      <Body>
        <b>Healthcare moved fastest.</b> We did not plan for HIPAA in year one.
        The market told us otherwise. We trained a sub-bench, signed BAAs, wrote
        a white paper, and now have HIPAA-segmented coverage in production. The
        economics work. We will publish more on this.
      </Body>
      <Body>
        <b>The integration is the edge.</b> When we started, we thought
        integration with AI tools was a feature. It turned out to be the
        product. The press is only useful if it lands an engineer with context.
        Cursor, Claude, Replit, and Lovable each took weeks of partnership work
        and unlocked step-changes in customer outcomes. We treat integration
        depth as the central engineering investment now, not a peripheral one.
      </Body>

      <Subhead>What we got wrong about how the work feels</Subhead>
      <Body>
        We thought the press, on the engineer&rsquo;s end, would feel like
        on-call. Asynchronous. Punctuated. It does not. It feels like a
        conversation. Engineers join a session and stay for forty minutes, not
        five, because the customer wants company through the build. The
        engineering team named this internally and we adopted it: not the press,
        the relay. The customer is running a leg, the engineer is running the
        next leg, and the baton is the build. We had been modeling something
        more transactional and the product had to be re-shaped to match what was
        actually happening.
      </Body>
      <Pullquote>
        We thought we were building an interrupt. We turned out to be building a
        conversation that comes in second.
      </Pullquote>

      <Subhead>What we&rsquo;re doing in year two</Subhead>
      <Body>
        We are organizing year two around three things. <b>One:</b> the
        enterprise rails, SSO, SAML, audit trails, the full compliance envelope,
        so a large platform team can adopt Relay without a six-month security
        review. <b>Two:</b> integration depth on five more AI builders, picked
        by customer demand. <b>Three:</b> growing the bench so a press is always
        answered, whatever hour you press it. We will probably miss one of these
        three. The other two will land.
      </Body>
      <Body>
        Year one was a hypothesis-test. Year two is operations. The work gets
        less interesting and the company gets more durable. That seems like the
        right trade.
      </Body>

      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        The founders, May 2026, on Relay&rsquo;s first birthday.
      </p>
    </ArticleShell>
  );
}
