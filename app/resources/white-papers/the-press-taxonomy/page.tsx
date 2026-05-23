/*
 * /resources/white-papers/the-press-taxonomy, White paper.
 */

import type { Metadata } from "next";
import { WhitePaperShell } from "../../_components/WhitePaperShell";
import { Body } from "../../_components/Body";
import { Section } from "../../_components/Section";
import { Subhead } from "../../_components/Subhead";
import { DataTable } from "../../_components/DataTable";
import { Callout } from "../../_components/Callout";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("white-papers", "the-press-taxonomy")!;

export const metadata: Metadata = metadataForPost(post);

const TOC = [
  { id: "premise", label: "From observation to instrument" },
  { id: "category-one", label: "Category one: the confidence wall" },
  { id: "category-two", label: "Category two: the integration cliff" },
  { id: "category-three", label: "Category three: the deploy moment" },
  { id: "category-four", label: "Category four: the ownership question" },
  { id: "instrumentation", label: "Instrumenting your own workflow" },
  { id: "policy", label: "Turning the taxonomy into policy" },
  { id: "anti-patterns", label: "Anti-patterns we see most often" },
];

export default function Page() {
  return (
    <WhitePaperShell
      tag={post.tag}
      byline={post.byline}
      date={post.date}
      readTime={post.readTime}
      titleHtml={post.titleHtml ?? post.title}
      lede={post.lede}
      currentPost={post}
      ctaHeadlineHtml="Four moments.<br /><em>One framework.</em>"
      summary={{
        takeaway:
          "AI-build workflows have four legible moments where human judgment matters most. Instrumenting them turns the press from reaction into policy.",
        bullets: [
          "We observed 4,217 presses in our beta and named the four categories that explain 92% of them: the confidence wall, the integration cliff, the deploy moment, the ownership question.",
          "Each category has a distinct trigger, a distinct shape of human work, and a distinct cost-of-getting-it-wrong. Treating them all as 'help requests' obscures all three.",
          "Engineering managers and platform teams can use the taxonomy as a framework: build internal tooling that detects when a build is approaching one of the four moments, and route a human into the loop deliberately.",
          "Policy follows from the taxonomy: which moments may proceed without a software engineer, which may not. The press, in our terms, is the enforcement primitive; in your terms it might be a code review, a deploy gate, or a slack ping.",
        ],
      }}
      toc={TOC}
      references={[
        {
          label:
            "Relay, Research: When does an AI build want a person? A study of 4,200 stuck moments",
          href: "/resources/research/when-does-an-ai-build-want-a-person",
          note: "The original research this paper formalizes.",
        },
        {
          label: "Relay, Field notes: Anatomy of the handoff",
          href: "/resources/articles/anatomy-of-the-handoff",
          note: "How we engineered the handoff to land in seconds.",
        },
        {
          label: "Relay, Article: The irreducibly human moment in software",
          href: "/resources/articles/the-irreducibly-human-moment",
          note: "The why behind the framework.",
        },
        {
          label: "Don Norman, The Design of Everyday Things",
          note: "On affordances and the moment a tool stops affording the next action.",
        },
        {
          label: "Atul Gawande, The Checklist Manifesto",
          note: "On instrumenting expertise into systems that catch failure before it propagates.",
        },
      ]}
    >
      <Section
        id="premise"
        eyebrow="01"
        heading="From observation to instrument"
      >
        <Body>
          The companion research paper,{" "}
          <em>When does an AI build want a person?</em>, presented the four
          categories as observation. This paper is a sequel: how to use the
          categories. The argument we make is short and operational. If you can
          detect, in your own AI-build workflow, when a build is approaching one
          of the four moments, you can route human judgment into it deliberately
          rather than reactively. You can write a policy around it. You can
          measure it. You can audit it.
        </Body>
        <Body>
          The press, in our product, is one implementation of that routing. It
          is not the only implementation. A code review on a merged PR, a deploy
          gate, a Slack-triggered async question to a tech lead, all of these
          are implementations of the same underlying primitive: a moment in the
          build where a human decides whether the next step is allowed.
        </Body>
        <Callout>
          The taxonomy is not specific to Relay. We use it because we sit at the
          surface where it surfaces hardest. Any platform team can adopt it.
        </Callout>
      </Section>

      <Section
        id="category-one"
        eyebrow="02"
        heading="Category one: the confidence wall"
      >
        <Body>
          The build technically works. The builder has clicked through it ten
          times. They cannot bring themselves to ship it because they do not
          know if it will hold.{" "}
          <strong>This is the most common category.</strong> Thirty-eight
          percent of the presses we analyzed were of this shape.
        </Body>
        <Subhead>What makes it detectable</Subhead>
        <Body>
          Three signals, in our data. First, the build has been completed to a
          runnable state for at least twenty minutes without shipping. Second,
          the builder has been re-running the same flow in dev or preview, in a
          way that suggests they&rsquo;re looking for a problem rather than
          building. Third, recent conversation context with the AI tool has
          shifted from construction questions (<em>how do I do X</em>) to
          validation questions (<em>does this look right</em>).
        </Body>
        <Subhead>What the human work looks like</Subhead>
        <Body>
          Read once. Answer one question: <em>can this ship to a customer?</em>{" "}
          The session is short by nature; our average is 14 minutes; the
          resolution rate is 96% because the question is tractable. The builder
          is not, in this category, asking for a fix. They are asking for
          permission, or for an articulated reason permission should not be
          granted.
        </Body>
        <Subhead>What gets it wrong</Subhead>
        <Body>
          Treating it as a code review. A code review tries to make the code
          better. The builder doesn&rsquo;t want better code. They want a
          one-sentence answer. Engineers who try to do a full review here
          over-deliver, frustrate the builder, and slow the ship. The right move
          is the answer, then the smallest set of notes the builder can act on.
        </Body>
      </Section>

      <Section
        id="category-two"
        eyebrow="03"
        heading="Category two: the integration cliff"
      >
        <Body>
          The AI produced a complete, runnable artifact. Connecting it to
          anything outside the sandbox, a database, an auth provider, a payment
          gateway, an email service, fails repeatedly in non-obvious ways.
          Twenty-nine percent of presses in our sample.
        </Body>
        <Subhead>What makes it detectable</Subhead>
        <Body>
          Repeated environment-variable churn. Failed deploys with shape
          differences in the error each time. Configuration files with
          contradictory values across copies. The build works locally; something
          fundamental is wrong about how it tries to reach the outside world.
          The AI has, in our experience, generated code that assumes one shape
          of integration and the customer&rsquo;s environment has another.
        </Body>
        <Subhead>What the human work looks like</Subhead>
        <Body>
          Read the integration carefully. Identify which assumption is wrong.
          Rewrite the smallest section of code that fixes it. Document the
          choice in a comment, in plain language, so the next AI session does
          not undo the fix.
        </Body>
        <Subhead>What gets it wrong</Subhead>
        <Body>
          Letting the AI tool retry. A common pattern: the AI sees the failed
          deploy, generates a new attempt, the attempt has the same wrong
          assumption, the deploy fails again. Without a human in the loop, the
          loop continues. The right move is to break the loop with a senior
          engineer&rsquo;s read.
        </Body>
      </Section>

      <Section
        id="category-three"
        eyebrow="04"
        heading="Category three: the deploy moment"
      >
        <Body>
          The build runs locally. The builder has a domain. They have not
          deployed software before. Seventeen percent of presses, and the
          longest in average duration: 1h 12min.
        </Body>
        <Subhead>What makes it detectable</Subhead>
        <Body>
          The build is in a runnable state. The builder is on the
          deploy-platform&rsquo;s onboarding flow for the first time. DNS
          questions enter the conversation. Production-readiness questions enter
          the conversation. The build has not yet touched a customer.
        </Body>
        <Subhead>What the human work looks like</Subhead>
        <Body>
          Walk through the deploy with the builder. Set up the small number of
          things AI tools systematically miss: TLS certificates,
          environment-variable separation between preview and production, a
          deployable rollback procedure, a basic uptime check. The work is
          teachable; the human delivers the knowledge once and the builder
          shouldn&rsquo;t need it again for the next deploy.
        </Body>
      </Section>

      <Section
        id="category-four"
        eyebrow="05"
        heading="Category four: the ownership question"
      >
        <Body>
          The build is shipped. Something has changed in the world. A payment
          failed; a user reported a bug; a third-party API silently changed
          shape. Eight percent of presses, but the highest
          sustained-relationship rate: 71% of these presses continue into an
          ongoing relationship.
        </Body>
        <Subhead>What makes it detectable</Subhead>
        <Body>
          The build is in production. The press happens not at build time but
          during the day, often during a customer&rsquo;s business hours. The
          trigger is external, a customer email, an alert from a monitoring
          tool, a teammate flagging a number that doesn&rsquo;t look right.
        </Body>
        <Subhead>What the human work looks like</Subhead>
        <Body>
          Diagnose. Decide. Sometimes the right answer is a code change;
          sometimes it&rsquo;s a configuration change; sometimes it&rsquo;s
          telling the customer about a third-party-vendor incident that
          isn&rsquo;t about the build at all. The work is closer to on-call than
          to building. It rewards engineers with operational experience.
        </Body>
      </Section>

      <Section
        id="instrumentation"
        eyebrow="06"
        heading="Instrumenting your own workflow"
      >
        <Body>
          What we recommend, for a platform team that wants to use this
          framework without adopting Relay.
        </Body>
        <Subhead>Build a press surface</Subhead>
        <Body>
          One button, one URL, one Slack command, the choice doesn&rsquo;t
          matter. What matters is that there is a single well-known place where
          a non-engineer can summon a software engineer mid-build, and that the
          surface is fast enough to be worth pressing.
        </Body>
        <Subhead>Detect the four moments</Subhead>
        <Body>
          Not algorithmically. Behaviorally. Tell every team that uses AI
          builders that there are four moments when the press is expected:{" "}
          <em>
            before customer ship, before integration, before deploy, after a
            production incident
          </em>
          . Make the press the default behavior at those moments rather than the
          exception.
        </Body>
        <Subhead>Measure</Subhead>
        <Body>
          Three numbers tell you whether the framework is working. Press volume
          per builder per week (the right level is non-zero for every active
          builder). Resolution rate (above 90% means the press is finding the
          right person). Builder retention (people who get value out of the
          press want to use it again; people who don&rsquo;t use it will not).
        </Body>
        <DataTable
          caption="Four-moment instrumentation pattern, by category."
          headers={["Category", "Trigger signal", "Routing", "Time-box"]}
          rows={[
            [
              "Confidence wall",
              "20+ min completed but unshipped",
              "Senior, any stack",
              "≤ 20 min",
            ],
            [
              "Integration cliff",
              "Repeated env-var churn",
              "Senior, stack-matched",
              "≤ 60 min",
            ],
            [
              "Deploy moment",
              "First-time deploy on platform",
              "Senior with deploys",
              "≤ 90 min",
            ],
            [
              "Ownership question",
              "Production-time external trigger",
              "Senior with on-call exp",
              "Open-ended",
            ],
          ]}
        />
      </Section>

      <Section
        id="policy"
        eyebrow="07"
        heading="Turning the taxonomy into policy"
      >
        <Body>Two policies are worth writing first.</Body>
        <Subhead>The press-required policy</Subhead>
        <Body>
          Specifies which builds, in which categories, may not ship without a
          press. Most companies start narrow: regulated data paths, identity
          flows, payments. Expand from there as the team builds confidence in
          the tooling.
        </Body>
        <Subhead>The press-encouraged policy</Subhead>
        <Body>
          Specifies the surfaces where a press is recommended but not required.
          The point of this policy is to remove stigma. The builder pressing for
          help should be celebrated, not penalized; the policy makes the
          encouragement explicit.
        </Body>
      </Section>

      <Section
        id="anti-patterns"
        eyebrow="08"
        heading="Anti-patterns we see most often"
      >
        <Body>
          <b>Routing all four categories to the same engineer pool.</b> The
          categories want different skills. A great deploy-moment engineer is
          not necessarily a great ownership-question engineer. Pool the bench
          but route by category.
        </Body>
        <Body>
          <b>Treating the press as a help desk.</b> A help desk has tickets and
          queues and SLAs measured in business days. The press is real-time and
          minutes. Confusing the two collapses quality and ruins the
          builder&rsquo;s incentive to press.
        </Body>
        <Body>
          <b>Measuring press time-to-close as the primary KPI.</b> A fast close
          on a build that should not have shipped is worse than a slow close
          that prevented the ship. Measure builder-shipped-without-incident as
          the primary; press time as secondary.
        </Body>
        <Body>
          <b>Skipping the ownership-question category.</b> Most teams
          we&rsquo;ve worked with build for the first three categories and
          forget the fourth. The fourth is where the relationship either
          compounds or breaks. Invest there even though the volume is the
          smallest.
        </Body>
      </Section>
    </WhitePaperShell>
  );
}
