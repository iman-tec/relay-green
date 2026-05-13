/*
 * /resources/blog/anatomy-of-the-handoff — Field notes.
 *
 * Server component. Engineering field-note write-up under the marketing Shell.
 */

import type { Metadata } from "next";
import { Shell } from "../../../_marketing/Shell";
import { TryRelayButton } from "../../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title:
    "Relay — Anatomy of the handoff: what we learned shipping the first 1,000 sessions.",
  description:
    "A median match in seconds isn’t a marketing number; it’s a system constraint we engineered toward and missed by 16 seconds in the first month.",
};

const bodyStyle = {
  fontSize: 16,
  lineHeight: 1.65,
  marginBottom: 14,
  maxWidth: "62ch",
} as const;

export default function FieldNotesPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">
            Field notes · Engineering · April 2026 · 9 min read
          </span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Anatomy of <em>the handoff.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            A median match in seconds isn&rsquo;t a marketing number; it&rsquo;s a system
            constraint we engineered toward and missed by 16 seconds in the
            first month.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <article>
            <p className="r-body" style={bodyStyle}>
              When we set the time-to-engineer target in seconds, the
              engineering team disagreed about whether it was a goal or a
              tagline. After a thousand sessions in the wild, the median is 74
              seconds. Here&rsquo;s how we got there, and what broke along the
              way.
            </p>
            <p className="r-body" style={bodyStyle}>
              <b>The press itself</b> is cheap. The hard work happens between
              the press and the moment an engineer types their first line into
              the customer&rsquo;s session. Three steps, in order: classify
              the session, find the engineer, hand them the context. We
              measured each.
            </p>
            <p className="r-body" style={bodyStyle}>
              <b>Classify (3&ndash;8s).</b> When you press, we look at the AI
              tool you&rsquo;re in, the language and framework, the size and
              recency of the diff, the error in the terminal if there is one,
              and any structured signals the integration provides (Cursor
              sends us project metadata, Lovable sends a snapshot URL, Claude
              sends the conversation handle). A small classifier turns this
              into a five-token routing tag. We rebuild this classifier
              monthly; it&rsquo;s the part of the system that gets
              meaningfully better the more presses we see.
            </p>
            <p className="r-body" style={bodyStyle}>
              <b>Match (12&ndash;28s).</b> The bench is sharded by routing
              tag. We don&rsquo;t broadcast &mdash; we use a priority queue
              per shard, with a fairness term so no engineer gets buried. The
              queue is shallow by design; if it&rsquo;s ever deeper than three
              we page an on-call to hire faster. The thing we learned the hard
              way: latency in the match step is dominated not by finding an
              available engineer but by their accept-the-handoff round trip.
              We dropped that from 11s to 4s by pre-loading customer context
              into the engineer&rsquo;s desktop the moment we route, before
              they accept.
            </p>
            <p className="r-body" style={bodyStyle}>
              <b>Hand off (35&ndash;55s).</b> The single biggest variable. If
              the integration is rich (Claude, Cursor, Replit) we&rsquo;re
              landing an engineer with the customer&rsquo;s repo open, the
              relevant file selected, and the last 20 turns of the AI
              conversation summarized in a side panel. If the integration is
              light (a copy-paste from a chat) the engineer is essentially
              walking into a room cold; we slow the customer down with a
              30-second &ldquo;tell me what you&rsquo;re trying to do&rdquo;
              that turns out to be the best thing we&rsquo;ve added.
            </p>
            <p className="r-body" style={bodyStyle}>
              The interesting bug: in the first month, our median was 106
              seconds, and we couldn&rsquo;t explain a 12-second hump in the
              distribution. It turned out to be Slack &mdash; the
              engineers&rsquo; on-call notifications were going through Slack
              mobile push, which is not built for sub-second delivery. We
              replaced it with a desktop-native nudge and the hump disappeared
              the next day.
            </p>
            <p className="r-body" style={bodyStyle}>
              The system fights for every second, and we still think we can
              take ten more out of the median before the end of the year. The
              point is not that 90 is magic. It&rsquo;s that the press is only
              useful if the answer arrives inside the same attention span the
              question lived in.
            </p>
            <p
              style={{
                fontStyle: "italic",
                color: "var(--ink-mute)",
                fontSize: 14,
                marginTop: 32,
              }}
            >
              &mdash; Posted from the engineering team. Comments and questions
              welcome at support@relay.green.
            </p>
          </article>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Press once.
            <br />
            <em>Median 74 seconds.</em>
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
