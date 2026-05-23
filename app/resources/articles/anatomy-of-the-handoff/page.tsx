/*
 * /resources/articles/anatomy-of-the-handoff, Field notes.
 *
 * Server component. Engineering field-note write-up under the shared
 * ArticleShell.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "anatomy-of-the-handoff")!;

export const metadata: Metadata = metadataForPost(post);

export default function FieldNotesPage() {
  return (
    <ArticleShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="Press once.<br /><em>Median 74 seconds.</em>"
    >
      <Body>
        When we set the time-to-engineer target in seconds, the engineering team
        disagreed about whether it was a goal or a tagline. After a thousand
        sessions in the wild, the median is 74 seconds. Here&rsquo;s how we got
        there, and what broke along the way.
      </Body>
      <Body>
        <b>The press itself</b> is cheap. The hard work happens between the
        press and the moment an engineer types their first line into the
        customer&rsquo;s session. Three steps, in order: classify the session,
        find the engineer, hand them the context. We measured each.
      </Body>
      <Body>
        <b>Classify (3&ndash;8s).</b> When you press, we look at the AI tool
        you&rsquo;re in, the language and framework, the size and recency of the
        diff, the error in the terminal if there is one, and any structured
        signals the integration provides (Cursor sends us project metadata,
        Lovable sends a snapshot URL, Claude sends the conversation handle). A
        small classifier turns this into a five-token routing tag. We rebuild
        this classifier monthly; it&rsquo;s the part of the system that gets
        meaningfully better the more presses we see.
      </Body>
      <Body>
        <b>Match (12&ndash;28s).</b> The bench is sharded by routing tag. We
        don&rsquo;t broadcast, we use a priority queue per shard, with a
        fairness term so no engineer gets buried. The queue is shallow by
        design; if it&rsquo;s ever deeper than three we page an on-call to hire
        faster. The thing we learned the hard way: latency in the match step is
        dominated not by finding an available engineer but by their
        accept-the-handoff round trip. We dropped that from 11s to 4s by
        pre-loading customer context into the engineer&rsquo;s desktop the
        moment we route, before they accept.
      </Body>
      <Body>
        <b>Hand off (35&ndash;55s).</b> The single biggest variable. If the
        integration is rich (Claude, Cursor, Replit) we&rsquo;re landing an
        engineer with the customer&rsquo;s repo open, the relevant file
        selected, and the last 20 turns of the AI conversation summarized in a
        side panel. If the integration is light (a copy-paste from a chat) the
        engineer is essentially walking into a room cold; we slow the customer
        down with a 30-second &ldquo;tell me what you&rsquo;re trying to
        do&rdquo; that turns out to be the best thing we&rsquo;ve added.
      </Body>
      <Body>
        The interesting bug: in the first month, our median was 106 seconds, and
        we couldn&rsquo;t explain a 12-second hump in the distribution. It
        turned out to be Slack, the engineers&rsquo; on-call notifications were
        going through Slack mobile push, which is not built for sub-second
        delivery. We replaced it with a desktop-native nudge and the hump
        disappeared the next day.
      </Body>
      <Body>
        The system fights for every second, and we still think we can take ten
        more out of the median before the end of the year. The point is not that
        90 is magic. It&rsquo;s that the press is only useful if the answer
        arrives inside the same attention span the question lived in.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Posted from the engineering team. Comments and questions welcome at
        support@relay.green.
      </p>
    </ArticleShell>
  );
}
