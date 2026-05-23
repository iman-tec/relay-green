/*
 * /resources/guides/buyers-guide-to-on-demand-engineering, Guide.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Subhead } from "../../_components/Subhead";
import { Callout } from "../../_components/Callout";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("guides", "buyers-guide-to-on-demand-engineering")!;

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
      ctaHeadlineHtml="Buy what holds.<br /><em>Press once.</em>"
    >
      <Body>
        We wrote this guide for the buyer who has been asked, by their CEO or by
        their CTO or by themselves, whether on-demand engineering is worth
        procuring, and from whom. The guide is deliberately vendor-neutral. We
        name the questions we&rsquo;d ask any vendor, including ourselves, and
        we explain how to read the answers. If the conclusion you reach after
        reading is to choose a competitor, we&rsquo;d rather you do that than
        choose us for the wrong reasons.
      </Body>
      <Pullquote>
        The right question is not <em>which vendor</em>. The right question is{" "}
        <em>what shape of help, in which moments, with what guarantees.</em>
      </Pullquote>

      <Subhead>Step one: name the moments you&rsquo;re buying for</Subhead>
      <Body>
        On-demand engineering is, at root, an answer to specific moments. Before
        you talk to vendors, write down the moments. The most common, in our
        experience:
      </Body>
      <Body>
        <b>The internal-builder moment.</b> A non-engineer in your company has
        built something with an AI tool and is about to ship it.{" "}
        <b>The migration moment.</b> A team is moving systems and needs senior
        engineering capacity that doesn&rsquo;t exist on payroll.{" "}
        <b>The integration moment.</b> The product-engineering team has built a
        thing that works internally but cannot survive contact with external
        systems. <b>The off-hours moment.</b> Production is on fire and the
        on-call rotation is thin.
      </Body>
      <Callout label="The trap to avoid here">
        Buying a generalized retainer because the moments aren&rsquo;t named.
        Generalized retainers underutilize, drift in scope, and get cut at the
        next budget review. Named moments make the value observable.
      </Callout>

      <Subhead>Step two: ask about the bench</Subhead>
      <Body>
        The bench is the set of engineers the vendor will route to your moments.
        Ask:
      </Body>
      <Body>
        <b>How big is the bench, and what&rsquo;s the bar?</b> A small bench at
        a high bar is usually better than a large bench at a mixed bar.
        Tier-based vendors will tell you the bench is large; ask how many of
        them are at the seniority you need.
      </Body>
      <Body>
        <b>How is the bench compensated?</b> 1099 contractors paid per-press
        will, on average, optimize for closing the press quickly. W-2 employees
        on retainer will, on average, optimize for the customer outcome. Both
        shapes can work. Ask which one you&rsquo;re buying.
      </Body>
      <Body>
        <b>Who routes the press, and on what criteria?</b> A vendor that lets
        the customer pick the engineer sounds appealing and produces a worse
        outcome at scale (the most-requested engineer gets buried; quality
        drops; no fairness). A vendor that routes algorithmically, by stack and
        availability, scales better.
      </Body>
      <Body>
        <b>What&rsquo;s the geographic distribution?</b> If you need 24/7
        coverage, the only honest answer is engineers in three time zones,
        working their local-day shifts. Anything else is a graveyard premium
        hidden in the price, or it&rsquo;s a fiction.
      </Body>

      <Subhead>Step three: ask about the press</Subhead>
      <Body>How does the vendor define the unit of work?</Body>
      <Body>
        <b>What&rsquo;s the median time-to-engineer?</b> Anything over five
        minutes is not on-demand; it&rsquo;s scheduled. Anything under sixty
        seconds with a flat-priced offer is too good to be true and the math
        should be inspected. Honest numbers are between 60 and 180 seconds.
      </Body>
      <Body>
        <b>What&rsquo;s recorded, and where does the recording live?</b> For
        regulated industries, the answer matters. For everyone else, it still
        matters: the session record is the audit trail.
      </Body>
      <Body>
        <b>What&rsquo;s the SLA when the press doesn&rsquo;t resolve?</b> Most
        vendors don&rsquo;t have one. Ask anyway. The answer tells you whether
        the vendor is taking ownership of the outcome or the activity.
      </Body>

      <Subhead>Step four: ask about pricing</Subhead>
      <Body>Three pricing shapes are common. Each has tradeoffs.</Body>
      <Body>
        <b>Per-press flat fee.</b> Honest for short presses; expensive for long
        ones. Predictable for budgeting. Watch for vendors that cap session
        length and re-charge for &ldquo;continuation.&rdquo;
      </Body>
      <Body>
        <b>Pre-purchased minutes / hours.</b> Honest economically; complicates
        internal accounting if usage spikes. Watch for expiration policies that
        effectively are use-it-or-lose-it.
      </Body>
      <Body>
        <b>Monthly retainer with rollover.</b> Cheapest at sustained volume;
        underutilized when volume is uneven. Watch for retainer sizes the vendor
        pushes you to that exceed observed press volume.
      </Body>

      <Subhead>Step five: ask about scope discipline</Subhead>
      <Body>
        The most common vendor failure is scope drift. A press that was supposed
        to be twenty minutes turns into a four-hour engineering project that
        nobody priced for. Ask:
      </Body>
      <Body>
        <b>
          What&rsquo;s the time-box on a press, and what happens at the box?
        </b>{" "}
        A clean answer: the engineer says they&rsquo;ve hit the box, names
        what&rsquo;s left, and the customer explicitly chooses to extend or
        close. A bad answer: the engineer keeps going. A bad answer disguised as
        a good one: the engineer wraps and a follow-up is silently scoped.
      </Body>
      <Body>
        <b>Can the vendor say no?</b> A vendor that has never refused a press is
        a vendor that ships things they shouldn&rsquo;t. Our own refusal rate
        sits around 2-4% in regulated environments. If a vendor claims 100%
        resolution, ask for the methodology.
      </Body>

      <Subhead>Step six: pilot before you commit</Subhead>
      <Body>
        Run a four-week pilot before signing for twelve months. The pilot should
        include:
      </Body>
      <Body>
        <b>One-to-three of your hardest expected presses.</b> Don&rsquo;t pilot
        with the easy ones; you&rsquo;re evaluating ceiling, not floor.{" "}
        <b>Multiple time zones if you need 24/7.</b> Schedule a press at 3am
        local; verify the answer arrives without quality loss.{" "}
        <b>An integration that touches a real system.</b> Vendors are good in
        sandboxes. The integration cliff is where most weak vendors fall over.{" "}
        <b>A failure-mode press.</b> Set up a press where the right answer is
        &ldquo;don&rsquo;t ship.&rdquo; Watch how the vendor handles the
        conversation.
      </Body>

      <Subhead>Step seven: the procurement traps</Subhead>
      <Body>Three patterns we see kill otherwise-good buys.</Body>
      <Body>
        <b>Buying for a moment that doesn&rsquo;t recur.</b> A vendor you use
        four times in the first quarter and never again is a vendor you should
        not have signed annually with. Start month- to-month if uncertain.
      </Body>
      <Body>
        <b>Mistaking the demo for the bench.</b> The engineer who runs the sales
        demo is, at most vendors, not the engineer who picks up the press. Ask
        to meet two engineers from the bench; the difference will be
        informative.
      </Body>
      <Body>
        <b>Skipping the BAA / DPA review.</b> If your environment has regulated
        data, the security review is the procurement critical-path, not the
        commercial one. Start it on day one.
      </Body>

      <Subhead>What &ldquo;good&rdquo; looks like, in a sentence</Subhead>
      <Body>
        A software engineer arrives in seconds, reads the build, says what holds
        and what doesn&rsquo;t, makes the smallest correct change, narrates it,
        hands the build back, and leaves. Anything more than that is overhead.
        Anything less and the vendor isn&rsquo;t the buyer&rsquo;s asset;
        it&rsquo;s the buyer&rsquo;s liability.
      </Body>
    </ArticleShell>
  );
}
