/*
 * /resources/articles/the-irreducibly-human-moment, Essay.
 *
 * Server component. Long-form prose under the shared ArticleShell.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "the-irreducibly-human-moment")!;

export const metadata: Metadata = metadataForPost(post);

export default function EssayPage() {
  return (
    <ArticleShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      ctaHeadlineHtml="Press the dot.<br /><em>An engineer joins in seconds.</em>"
      currentPost={post}
    >
      <Body>
        Software is following the path coal once did. When a thing gets cheaper,
        we don&rsquo;t use less of it. We use a great deal more. The cost of a
        working line of code, written by a person sitting at a keyboard, has
        been falling for two years now at the speed of model improvement. The
        amount of software being written is not falling with it. The opposite.
        We are in the early innings of what will, in retrospect, look like an
        explosion.
      </Body>
      <Body>
        The question that follows is not whether engineers still matter. They
        do. The question is what they do, and where they sit in the build. We
        think about this question a lot. We started Relay because the answer
        surprised us.
      </Body>
      <Pullquote>
        An engineer&rsquo;s job is no longer to write the line. It is to be the
        person on the other end of a press.
      </Pullquote>
      <Body>
        For most of software&rsquo;s history, an engineer wrote the line. The
        line was the unit of value. A junior engineer wrote a line; a senior
        engineer wrote a better one; a staff engineer reviewed the lines of
        others and made them coherent. The pyramid was tall and the work was
        vertical.
      </Body>
      <Body>
        That pyramid is collapsing into a plane. Today a marketing manager in
        Dallas, a clinical-operations lead in Seattle, an analyst in Mumbai ,
        anyone with a tool and an idea, is producing code. They are not
        engineers, and they will not become engineers, and the software they
        produce is good enough to use. Most of it ships in some form. Some of it
        ships in a form that should not have shipped.
      </Body>
      <Body>
        The work that distinguishes those two outcomes is not the writing of the
        line. It is the press of a button. It is the moment a person who has
        shipped this kind of system before walks into the room, looks at the
        diff, and says one of three things. <em>This is fine, ship it.</em> Or{" "}
        <em>this will break here, change this.</em> Or{" "}
        <em>do not ship this; I will rewrite it with you.</em> The decision is
        small. The compounding effect, across thousands of builds inside a
        single company, is not.
      </Body>
      <Body>
        That is the work an engineer does now. Not the line. The decision. The
        relay.
      </Body>
      <Body>
        The category we are building is the category of that decision. We
        don&rsquo;t think it has a good name yet. <em>Engineer-as-a-service</em>{" "}
        is too transactional. <em>AI co-pilot</em> is taken and points the wrong
        direction. <em>Pair programming</em> is too symmetric. The work is
        asymmetric: the AI runs eighty percent of the build, the person runs the
        moment that decides whether the build ships. We&rsquo;re calling it the
        press. The dot in the corner. The relay.
      </Body>
      <Body>
        This is a long way of saying the obvious thing. Software engineering is
        not going away. It is moving. It is moving from the inside of a single
        company&rsquo;s payroll to the outside of every company&rsquo;s build
        session. It is moving from a salary line to a press. It is becoming, for
        the first time in the history of the craft, available the same way
        electricity is available. You press, it arrives, it does the thing only
        it can do, and then it leaves, and the build goes on.
      </Body>
      <Body>That&rsquo;s what we&rsquo;re building.</Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        The founders, May 2026
      </p>
    </ArticleShell>
  );
}
