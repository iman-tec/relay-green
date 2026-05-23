/*
 * /resources/articles/why-we-dont-do-tiers, Field notes.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "why-we-dont-do-tiers")!;

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
      ctaHeadlineHtml="One bench.<br /><em>One bar.</em>"
    >
      <Body>
        Every services company we benchmarked before launching Relay had tiers.
        Junior, mid, senior. Or bronze, silver, gold. Or T2, T3, T4. Customers
        picked a tier when they signed; the engineer they got depended on what
        they had paid for. The economics make sense on a spreadsheet. We
        don&rsquo;t do it.
      </Body>
      <Body>
        We have one bench. Every engineer on it is senior by every reasonable
        measure. A press routes by stack and by availability, not by what plan
        the customer is on. The customer who pays the lowest price gets the same
        engineer the customer who pays the highest price gets.
      </Body>
      <Pullquote>
        A tier is a way of telling some customers their problem isn&rsquo;t
        worth a software engineer. We don&rsquo;t believe that.
      </Pullquote>
      <Body>
        Three reasons we do it this way. They&rsquo;re ordered by how much we
        believe in them.
      </Body>
      <Body>
        <b>One. The press is short.</b> A median Relay session is twenty-eight
        minutes. Inside that window, the cost difference between a senior
        engineer and a junior one is the cost difference between the customer
        shipping and not shipping. We can&rsquo;t price the difference cleanly
        enough to charge for it; the spread we&rsquo;d introduce by tiering is
        larger than the spread we&rsquo;d capture in revenue. So we don&rsquo;t.
      </Body>
      <Body>
        <b>Two. The promise breaks the moment you tier.</b> &ldquo;Click the
        green dot. A real engineer joins in seconds.&rdquo; If we tiered, the
        promise would have an asterisk.{" "}
        <em>
          A real engineer of the seniority you have paid for joins in seconds.
        </em>{" "}
        The asterisk would make the product worse, in a way the spreadsheet
        wouldn&rsquo;t catch.
      </Body>
      <Body>
        <b>Three. The bar is easier to maintain at one level than at three.</b>{" "}
        We can hire for one bar and write down what that bar is. We tested the
        alternative on paper and concluded it would slow our hiring, complicate
        our matching, and create a tier-of-engineer-to-tier-of- customer routing
        problem we did not want to solve. The flat bench is a hiring discipline
        as much as a customer promise.
      </Body>
      <Body>
        The cost of this choice is real. Some presses don&rsquo;t need a senior
        engineer; they could be solved by a competent mid-level one for half the
        price. We absorb that delta. We have decided we&rsquo;d rather absorb it
        than write a routing system that asks customers, every time they press,
        what version of help they would like to pay for.
      </Body>
      <Body>
        We&rsquo;ll say what would change our mind. If we found that more than a
        third of our presses were genuinely well-served by a less senior
        engineer, and we found a clean way to identify those presses before
        routing, we would consider it. We have not. Our internal data suggests
        the opposite: a press that looks junior at first turns out, in two
        thirds of cases, to need senior judgment by minute four. We prefer to
        route to the seniority the press will need by minute four, not the
        seniority it looks like at minute zero.
      </Body>
      <Body>
        That&rsquo;s the engineering reason. The customer reason is simpler.
        Every customer we have wants the software engineer. They have always
        wanted the software engineer. The reason there are tiers in our industry
        is that the software engineer was scarce. We have organized the company
        around making the software engineer not scarce. There is nothing else to
        charge for.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Engineering, Relay. April 2026.
      </p>
    </ArticleShell>
  );
}
