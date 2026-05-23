/*
 * /resources/articles/a-craftspersons-code, Policy.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "a-craftspersons-code")!;

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
      ctaHeadlineHtml="A bench that holds a line.<br /><em>By choice.</em>"
    >
      <Body>
        Every Relay engineer signs this before they ever take a press. We
        publish it for two reasons. The first is so a customer can hold us to
        it. The second is so an engineer thinking about joining knows what kind
        of work, and what kind of restraint, the work involves.
      </Body>
      <Body>
        It is short by design. It is also literal. Each line is a thing we have,
        at some point, watched go wrong, and decided to write down so it goes
        wrong less often.
      </Body>

      <Subhead>One. The customer&rsquo;s name is on it</Subhead>
      <Body>
        Code that ships from a press goes out under the customer&rsquo;s name.
        Not ours. We do not embed credit lines, beacons, comments with our URL,
        or anything else that would let a future reader trace the diff back to
        Relay. The customer is the author. We helped.
      </Body>

      <Subhead>Two. We do not write what we do not understand</Subhead>
      <Body>
        If a press requires a system or a domain we do not know, an unfamiliar
        database, a regulated workflow, a language we&rsquo;ve only seen in a
        tutorial, we say so, immediately, and we hand the press to someone on
        the bench who does. We do not learn on a customer&rsquo;s clock unless
        the customer has explicitly bought learning time. The bench is wide
        enough that this almost never costs the customer a press.
      </Body>

      <Subhead>Three. We never silently rewrite</Subhead>
      <Body>
        If we change something the customer wrote, the customer sees the change
        before the change ships. Not after. We use diffs. We narrate the diff.
        The customer says yes or no. The number of times an engineer has shipped
        &ldquo;a small fix&rdquo; that turned out to be a quiet rewrite is
        large. We refuse the pattern.
      </Body>

      <Subhead>Four. We tell the customer when to stop</Subhead>
      <Body>
        The hardest line for an engineer to say is{" "}
        <em>do not ship this; rewrite it.</em> We say it. The point of a press
        is not to keep the build moving. The point of a press is to put a person
        who has shipped this kind of system before in front of the decision the
        AI cannot make on its own. Sometimes that decision is no.
      </Body>

      <Subhead>Five. We hand off, and we say so</Subhead>
      <Body>
        If we cannot finish a press inside the time it should take, we hand it
        to another engineer, and we tell the customer we are doing it, and the
        new engineer reads what came before. Continuity is not the absence of
        handoff. It is the cleanness of the handoff. The customer should never
        be the person carrying context across a swap.
      </Body>

      <Subhead>Six. We do not optimize the press into nothing</Subhead>
      <Body>
        The temptation is real. A press that resolves in nine minutes instead of
        fourteen looks like a win on the dashboard. It is not, if the resolution
        is &ldquo;ship it&rdquo; on a build that should not have shipped. We
        measure the press by what holds, not by what closed.
      </Body>

      <Subhead>Seven. We protect the customer&rsquo;s data</Subhead>
      <Body>
        We touch a customer&rsquo;s code, environment, and sometimes their
        users&rsquo; data. We treat all of it the way we would want a stranger
        to treat ours. Nothing leaves the session that the customer did not see
        leave. No paste into ChatGPT, no screenshot to a friend, no &ldquo;quick
        check&rdquo; with a tool that retains. The session is the perimeter.
      </Body>

      <Subhead>Eight. We are kind</Subhead>
      <Body>
        Most presses are someone admitting they are stuck. Some are someone
        admitting they are scared. None of them are an opportunity to
        demonstrate seniority at the customer&rsquo;s expense. We answer the
        question that was asked. We answer the question behind the question when
        it&rsquo;s clearly there. We don&rsquo;t make the customer feel small
        for not knowing.
      </Body>

      <Body>
        Eight lines. The next year will probably teach us a ninth, and a tenth.
        When it does we will write them down here, with a date next to them.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Relay Standards. Last revised May 2026.
      </p>
    </ArticleShell>
  );
}
