/*
 * /resources/blog/the-irreducibly-human-moment — Essay.
 *
 * Server component. Long-form prose under the marketing Shell.
 */

import type { Metadata } from "next";
import { Shell } from "../../../_marketing/Shell";
import { TryRelayButton } from "../../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — The irreducibly human moment in software",
  description:
    "An argument for why senior engineering doesn’t shrink in the age of AI — it sharpens, and moves to a new place in the build.",
};

const bodyStyle = {
  fontSize: 16,
  lineHeight: 1.65,
  marginBottom: 14,
  maxWidth: "62ch",
} as const;

const blockquoteStyle = {
  borderLeft: "3px solid var(--green)",
  padding: "8px 0 8px 24px",
  margin: "24px 0",
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: 20,
  maxWidth: "56ch",
} as const;

export default function EssayPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">
            Essay · By the founders · May 2026 · 11 min read
          </span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            The irreducibly <em>human moment</em> in software.
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            An argument for why senior engineering doesn&rsquo;t shrink in the
            age of AI &mdash; it sharpens, and moves to a new place in the
            build.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <article>
            <p className="r-body" style={bodyStyle}>
              Software is following the path coal once did. When a thing gets
              cheaper, we don&rsquo;t use less of it. We use a great deal more.
              The cost of a working line of code, written by a person sitting
              at a keyboard, has been falling for two years now at the speed
              of model improvement. The amount of software being written is
              not falling with it. The opposite. We are in the early innings
              of what will, in retrospect, look like an explosion.
            </p>
            <p className="r-body" style={bodyStyle}>
              The question that follows is not whether engineers still matter.
              They do. The question is what they do, and where they sit in the
              build. We think about this question a lot. We started Relay
              because the answer surprised us.
            </p>
            <blockquote style={blockquoteStyle}>
              An engineer&rsquo;s job is no longer to write the line. It is to
              be the person on the other end of a press.
            </blockquote>
            <p className="r-body" style={bodyStyle}>
              For most of software&rsquo;s history, an engineer wrote the
              line. The line was the unit of value. A junior engineer wrote a
              line; a senior engineer wrote a better one; a staff engineer
              reviewed the lines of others and made them coherent. The pyramid
              was tall and the work was vertical.
            </p>
            <p className="r-body" style={bodyStyle}>
              That pyramid is collapsing into a plane. Today a marketing
              manager in Dallas, a clinical-operations lead in Seattle, an
              analyst in Mumbai &mdash; anyone with a tool and an idea &mdash;
              is producing code. They are not engineers, and they will not
              become engineers, and the software they produce is good enough
              to use. Most of it ships in some form. Some of it ships in a
              form that should not have shipped.
            </p>
            <p className="r-body" style={bodyStyle}>
              The work that distinguishes those two outcomes is not the
              writing of the line. It is the press of a button. It is the
              moment a person who has shipped this kind of system before walks
              into the room, looks at the diff, and says one of three things.{" "}
              <em>This is fine, ship it.</em> Or{" "}
              <em>this will break here, change this.</em> Or{" "}
              <em>do not ship this; I will rewrite it with you.</em> The
              decision is small. The compounding effect, across thousands of
              builds inside a single company, is not.
            </p>
            <p className="r-body" style={bodyStyle}>
              That is the work an engineer does now. Not the line. The
              decision. The relay.
            </p>
            <p className="r-body" style={bodyStyle}>
              The category we are building is the category of that decision.
              We don&rsquo;t think it has a good name yet.{" "}
              <em>Engineer-as-a-service</em> is too transactional.{" "}
              <em>AI co-pilot</em> is taken and points the wrong direction.{" "}
              <em>Pair programming</em> is too symmetric. The work is
              asymmetric: the AI runs eighty percent of the build, the person
              runs the moment that decides whether the build ships.
              We&rsquo;re calling it the press. The dot in the corner. The
              relay.
            </p>
            <p className="r-body" style={bodyStyle}>
              This is a long way of saying the obvious thing. Senior
              engineering is not going away. It is moving. It is moving from
              the inside of a single company&rsquo;s payroll to the outside of
              every company&rsquo;s build session. It is moving from a salary
              line to a press. It is becoming, for the first time in the
              history of the craft, available the same way electricity is
              available. You press, it arrives, it does the thing only it can
              do, and then it leaves, and the build goes on.
            </p>
            <p className="r-body" style={bodyStyle}>
              That&rsquo;s what we&rsquo;re building.
            </p>
            <p
              style={{
                fontStyle: "italic",
                color: "var(--ink-mute)",
                fontSize: 14,
                marginTop: 32,
              }}
            >
              &mdash; The founders, Manhattan, May 2026
            </p>
          </article>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Press the dot.
            <br />
            <em>An engineer joins in seconds.</em>
          </h2>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <TryRelayButton />
          </div>
        </div>
      </section>
    </Shell>
  );
}
