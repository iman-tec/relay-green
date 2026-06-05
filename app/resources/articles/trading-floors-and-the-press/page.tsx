/*
 * /resources/articles/trading-floors-and-the-press, Industry essay.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "trading-floors-and-the-press")!;

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
      ctaHeadlineHtml="The opening bell.<br /><em>And the engineer who knows.</em>"
    >
      <Body>
        On 1 August 2012, a market-making firm in New Jersey deployed an update
        to a routing system. A configuration was missed on one of eight servers.
        For forty-five minutes after the opening bell, the firm sent millions of
        unintended orders into the market. By the time the system was stopped,
        the firm had taken a four-hundred- and-sixty-million-dollar loss. The
        capital had been raised in five years. It evaporated in less than a
        single trading session.
      </Body>
      <Body>
        Knight Capital is a story you hear told inside every bank&rsquo;s
        engineering org because it answers, in one number, why financial
        software has the controls it has. The financial system has a long memory
        of what bad code costs at market open.
      </Body>
      <Pullquote>
        The cost of bad software in finance is not measured in user complaints.
        It is measured in the time it takes to lose the company.
      </Pullquote>

      <Subhead>Where AI builds belong on the desk</Subhead>
      <Body>
        AI-built software has plenty of room on a trading floor. None of that
        room sits between a portfolio manager&rsquo;s decision and the order
        that lands on an exchange. That path is short, well-controlled, and
        audited to the millisecond. It is not the path that&rsquo;s changing
        because of AI builders.
      </Body>
      <Body>
        The path that&rsquo;s changing is the path beside it. The analyst-tool
        path. The risk-summary path. The client-letter-generation path. The
        compliance-monitoring-second- line-of-defense path. The
        internal-operations-dashboard path. These are the paths where a person
        who is not, by job title, an engineer, has been wanting tools for years
        and has been told there is a six-quarter backlog. Those are the tools
        that AI builders are making feasible. And those are the tools where the
        press matters.
      </Body>

      <Subhead>What the press protects against, in finance</Subhead>
      <Body>Three things, in the order we see them most often.</Body>
      <Body>
        <b>The unintended scope.</b> A risk analyst builds an internal tool that
        summarizes overnight position exposure. The first version works. The
        second version, six weeks later, has accidentally become the system that
        drives the morning risk meeting. By the third version, an internal
        stakeholder uses it for a regulatory report. Nobody intended this.
        Nobody architected it. The press is for the moment somebody asks{" "}
        <em>can we use this for the regulator report?</em> and a software
        engineer says{" "}
        <em>not in this shape; let&rsquo;s harden it before you do.</em>
      </Body>
      <Body>
        <b>The vendor-coupling drift.</b> AI tools love third-party APIs. A
        first-pass version uses a third-party data vendor for a market-data
        feed; the tool ships; six months later, the firm cannot replace the
        vendor without rebuilding the tool, because the AI used vendor-specific
        schema choices that nobody noticed in review. In finance, vendor
        concentration risk is a regulated concept. The press, here, is for the
        moment the third-party API is being chosen, not after the dependency has
        compounded.
      </Body>
      <Body>
        <b>The kill-switch absence.</b> If the tool starts behaving badly at
        9:31am, who can stop it, and how fast? AI-built first drafts do not have
        answers to this question. Software engineers do. The press, in many
        trading-floor sessions we&rsquo;ve run, ends up being a refactor that
        adds a circuit breaker, a feature flag, and an oncall path that did not
        exist in the original build. None of these are exotic. All of them are
        missing by default.
      </Body>

      <Subhead>What this means for buyers in finance</Subhead>
      <Body>
        Two things. <b>One:</b> let the analysts and traders build. The
        productivity is real and the alternative is shadow IT, which is worse.{" "}
        <b>Two:</b> draw a clear line between tools that touch the order path,
        the books-and-records path, and the regulator-facing path, which need a
        software engineer in the room before they ship, and tools that do not,
        which can ship freely. Make the line a policy. Make the press the
        enforcement.
      </Body>
      <Body>
        The financial industry&rsquo;s instinct to over-engineer the order path
        was earned the hard way. The instinct will, correctly, extend to
        AI-built order-path tools, and those will not happen soon. What is
        happening, today, is the rest of the floor. The press is for the rest of
        the floor.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Industry essay. We are not investment professionals. None of this is
        investment advice. All of it is engineering opinion, held loosely.
      </p>
    </ArticleShell>
  );
}
