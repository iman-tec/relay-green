/*
 * /resources/articles/what-we-look-for-in-a-relay-engineer, Field notes.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Subhead } from "../../_components/Subhead";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "what-we-look-for-in-a-relay-engineer")!;

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
      ctaHeadlineHtml="The bar.<br /><em>In writing.</em>"
    >
      <Body>
        We get asked, often, what makes a Relay engineer different from a senior
        engineer at a normal company. Some of the answer is the same. Most of it
        is not. The job is not building features inside one codebase you know
        well. The job is walking into a stranger&rsquo;s IDE for fourteen
        minutes and being useful inside the first three. That changes what we
        look for.
      </Body>
      <Body>
        Five things we test for. Three things we&rsquo;ve learned not to.
      </Body>

      <Subhead>One. They can read code they did not write</Subhead>
      <Body>
        The single biggest predictor of a Relay engineer who is going to be good
        at Relay is comfort reading other people&rsquo;s code. Not just clean
        code. AI-generated code, with the small inconsistencies AI makes; legacy
        code that has been edited by six humans and three agents; weekend code
        that the customer is mildly embarrassed by. A software engineer who has
        only ever read their own code is, in practice, a junior engineer in our
        setting. We test for this directly in the interview, with a real
        anonymized session transcript.
      </Body>

      <Subhead>Two. They are calm under a stranger&rsquo;s gaze</Subhead>
      <Body>
        The customer is watching. They are usually anxious. They are usually on
        a deadline. The engineer who tries to perform seniority in this moment
        makes the customer more anxious, not less. The engineer who narrates
        clearly, asks one question, and starts typing makes the customer settle.
        We learned this the hard way; some of our most decorated engineers, on
        paper, were not the engineers we wanted next to a customer in a stuck
        moment. Calmness is not a soft skill in this job. It is the job.
      </Body>

      <Subhead>Three. They know what they don&rsquo;t know</Subhead>
      <Body>
        A Relay engineer who tries to bluff their way through an unfamiliar
        framework will, eventually, ship something that breaks. The engineer we
        want says, in the first minute,{" "}
        <em>
          this is not a stack I&rsquo;ve shipped before; let me grab a teammate
          who has.
        </em>{" "}
        The bench has redundancy by design. Asking for the right teammate is
        rewarded inside Relay. Faking it is the only firing offense we have
        written down.
      </Body>

      <Subhead>
        Four. They write a diff before they argue with a customer
      </Subhead>
      <Body>
        The shortest path between disagreement and decision is a working diff.
        The Relay engineer who feels strongly that the customer&rsquo;s approach
        is wrong does not write a paragraph. They write the alternative, narrate
        it, and let the customer choose. The conversation goes from{" "}
        <em>I think</em> to <em>here&rsquo;s the difference, picked.</em>{" "}
        Sessions resolve faster, and customers say <em>yes</em> more often, when
        this is the default move.
      </Body>

      <Subhead>Five. They finish</Subhead>
      <Body>
        A press is not over because time is up. A press is over because the
        thing the customer pressed for is unblocked, with the customer&rsquo;s
        consent. The engineers who are good at Relay protect the close. They
        write a one-line summary of what changed, what to verify, and what to do
        if it breaks. They make the customer feel ownership of the diff before
        the engineer drops out. We see customers come back for the same engineer
        specifically because of this habit.
      </Body>

      <Subhead>What we&rsquo;ve learned not to test for</Subhead>
      <Body>
        <b>Algorithm puzzles.</b> We had them in the original loop. They
        screened out engineers who were great at presses and screened in
        engineers who were great at LeetCode and not at calming a person down.
        We removed them.
      </Body>
      <Body>
        <b>Years of experience past a threshold.</b> Eight years and twenty
        years are indistinguishable in our work. Two years and eight years are
        not. We test the floor and stop counting.
      </Body>
      <Body>
        <b>Specific stack expertise, narrowly defined.</b> The bench is wide; we
        route by stack inside the system. An engineer who is unbeatable at one
        stack but uncomfortable outside it is a fine hire for a normal company
        and an awkward fit for ours. We hire engineers who are comfortable
        enough across enough stacks that the routing system has somewhere to put
        them.
      </Body>

      <Body>
        We are wrong about some of this and will discover it within the year.
        When we do, we&rsquo;ll write down what changed and why, here.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        Hiring, Relay. Comments to support@relay.green.
      </p>
    </ArticleShell>
  );
}
