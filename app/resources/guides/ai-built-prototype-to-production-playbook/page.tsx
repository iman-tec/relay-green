/*
 * /resources/guides/ai-built-prototype-to-production-playbook, Guide.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Subhead } from "../../_components/Subhead";
import { Callout } from "../../_components/Callout";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("guides", "ai-built-prototype-to-production-playbook")!;

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
      ctaHeadlineHtml="Day 1 to day 30.<br /><em>Then the day-31 question.</em>"
    >
      <Body>
        You shipped a prototype with Lovable, Claude, Cursor, or Bolt. Customers
        can use it. The build works. You are now in the gap between{" "}
        <em>working</em> and <em>production</em>, and the gap is bigger than the
        AI tool advertised. This is the day-by- day playbook we walk our
        customers through. Thirty working days. Most builds finish faster. None
        should take meaningfully longer.
      </Body>
      <Pullquote>
        A prototype is built. A production system is decided. The work is the
        deciding.
      </Pullquote>

      <Subhead>Week 1, the readiness audit</Subhead>
      <Body>
        Before you fix anything, you have to know what&rsquo;s wrong. A senior
        engineer reads the codebase end-to-end and writes a readiness audit. The
        audit is not a code review. It is a list, in priority order, of every
        issue that would prevent the build from being a production system. Most
        builds, in our experience, have between fifteen and forty findings.
      </Body>
      <Body>
        <b>Day 1.</b> Read the codebase. Take notes; don&rsquo;t fix.
      </Body>
      <Body>
        <b>Day 2.</b> Map data flows. Where does production data come from,
        where does it go, what touches it. AI-generated code often has surprises
        here.
      </Body>
      <Body>
        <b>Day 3.</b> Run the smallest plausible test of the unhappy paths. What
        happens when the API is down? When auth fails? When the database is
        slow? Note what breaks in interesting ways.
      </Body>
      <Body>
        <b>Day 4.</b> Write the audit. Categorize: must-fix-before- production,
        should-fix-soon, can-wait. The first category should be small and
        ruthless.
      </Body>
      <Body>
        <b>Day 5.</b> Review with the founder or product lead. Get explicit
        alignment on the must-fix list. Cut anything that isn&rsquo;t. Two
        hours.
      </Body>

      <Subhead>Week 2, the security pass</Subhead>
      <Body>
        AI-generated code is, on average, slightly worse on security than human
        code at the same maturity level. The pattern is consistent: secrets in
        source, permissive CORS, missing rate-limits, weak input validation,
        occasionally a SQL pattern that should never see daylight.
      </Body>
      <Body>
        <b>Day 6.</b> Sweep for secrets. Move every API key, password, and token
        out of source. Rotate the ones that lived in source. This is the single
        highest-value day of the playbook.
      </Body>
      <Body>
        <b>Day 7.</b> Auth and identity. Confirm every endpoint either is
        intentionally public or requires authentication. AI tools love to
        default to permissive; close the gap.
      </Body>
      <Body>
        <b>Day 8.</b> Input validation and rate limits. Every form, every API
        endpoint. The AI assumed clean input. Customers won&rsquo;t provide it.
      </Body>
      <Body>
        <b>Day 9.</b> Database access patterns. Look for queries built from user
        input via string concatenation. Replace with parameterization. This is
        rare in 2026 generations but not zero.
      </Body>
      <Body>
        <b>Day 10.</b> Penetration self-test. Try to break the things you just
        fixed. If you can, fix again.
      </Body>
      <Callout label="When to press">
        Day 6 and Day 9 are the two days where a software engineer in the room
        compounds value most. The engineer with secrets-rotation and
        SQL-injection experience moves five times faster than the AI tool
        unsupervised.
      </Callout>

      <Subhead>Week 3, the operational pass</Subhead>
      <Body>
        AI-built systems often have no operational story. They were designed to
        run; they were not designed to run while a person sleeps. This week is
        about the difference.
      </Body>
      <Body>
        <b>Day 11.</b> Logging. Every error path produces a log line. Every log
        line has enough context to be debugged later (request ID, user ID where
        applicable, the relevant input shape).
      </Body>
      <Body>
        <b>Day 12.</b> Monitoring. At minimum: uptime check, error rate alarm,
        latency alarm. Wire to a real notification path; not email, ideally.
      </Body>
      <Body>
        <b>Day 13.</b> Backups and restores. Backups exist; restores have been
        tested. AI-built systems sometimes have backups that have never been
        restored, which is the same as no backup.
      </Body>
      <Body>
        <b>Day 14.</b> Configuration management. Every environment variable in
        every environment is accounted for. Production and staging are different
        in known, intentional ways.
      </Body>
      <Body>
        <b>Day 15.</b> The runbook. One page. What does each alert mean?
        What&rsquo;s the first thing to do when it fires? Who gets paged?
        Where&rsquo;s the kill switch?
      </Body>

      <Subhead>Week 4, the deployment pass</Subhead>
      <Body>
        AI tools deploy. They deploy well. They deploy in a way that
        doesn&rsquo;t survive contact with a real growth curve.
      </Body>
      <Body>
        <b>Day 16.</b> Domain, DNS, TLS. Confirm certificate auto-renewal.
        Confirm DNS is pointed at infrastructure you control or trust.
      </Body>
      <Body>
        <b>Day 17.</b> Deploy pipeline. Every shipping path goes through a
        single, observable, revertible mechanism. Vibe-deploys (push a button,
        hope) are the source of most weekend incidents.
      </Body>
      <Body>
        <b>Day 18.</b> Rollback procedure. Test it. Verify the rollback actually
        returns the system to a known-good state in under five minutes.
      </Body>
      <Body>
        <b>Day 19.</b> Performance baseline. Synthetic load test, even a small
        one. Now you know the cliff.
      </Body>
      <Body>
        <b>Day 20.</b> Cost ceiling. Set hard limits on the bills that can run
        away, cloud, AI APIs, third-party services. AI tools love to enable
        elastic billing; production wants ceilings.
      </Body>

      <Subhead>Week 5, the documentation pass</Subhead>
      <Body>
        The system has to be operable by the second engineer. Often the second
        engineer is six-month-future-you, who has forgotten what the first
        engineer (current you, with the AI) decided.
      </Body>
      <Body>
        <b>Day 21.</b> Architecture overview. One diagram, one page. What talks
        to what. Where the data lives. What the choices were and why.
      </Body>
      <Body>
        <b>Day 22.</b> README that runs. Clone, install, run, deploy. Every
        command works on a clean machine.
      </Body>
      <Body>
        <b>Day 23.</b> Decision log. What did we choose, what did we reject,
        why. Three sentences per decision. Six months from now, this saves a
        week.
      </Body>
      <Body>
        <b>Day 24.</b> Critical paths walkthrough. The two or three flows the
        customer cares most about, with the code paths annotated.
      </Body>
      <Body>
        <b>Day 25.</b> Test coverage. Not 100%. The unhappy paths and the money
        paths. AI tools generate tests that test what is easy to test; the work
        is filling the gap.
      </Body>

      <Subhead>Week 6, the customer pass</Subhead>
      <Body>
        The system is technically ready. Now it has to survive customers.
      </Body>
      <Body>
        <b>Day 26.</b> Onboarding flow. New customer signs up; what happens.
        Walk it. Time it. Note every place that breaks emotional momentum.
      </Body>
      <Body>
        <b>Day 27.</b> Error messages. Read every error path. AI tools write
        error messages for engineers; customers want messages for customers.
      </Body>
      <Body>
        <b>Day 28.</b> Support path. When a customer is stuck, what do they do?
        If the answer is &ldquo;email founder@,&rdquo; that&rsquo;s fine for the
        first hundred. Plan the second hundred.
      </Body>
      <Body>
        <b>Day 29.</b> Privacy and terms. The legal pages exist. They say what
        they need to say. They&rsquo;ve been read by the person responsible for
        them.
      </Body>
      <Body>
        <b>Day 30.</b> Soft launch. Five real customers. Watch everything that
        happens. Fix the most embarrassing thing before the next five.
      </Body>

      <Subhead>The day-31 question</Subhead>
      <Body>
        Who owns this? The system is now real, and it will keep breaking,
        slowly, in ways AI tools cannot predict. The day-31 question is whether
        you have an engineer (in-house, on contract, on press) who knows this
        codebase and can pick up the next incident.
      </Body>
      <Body>
        Three honest answers. <b>One:</b> in-house, you. Works for small builds;
        doesn&rsquo;t scale past one. <b>Two:</b> in-house, a hire. Works once
        you have ten things that need an engineer.
        <b> Three:</b> on-demand, the press. Works for the in-between, which is
        most of where AI-built systems live.
      </Body>
      <Body>
        Pick the one that fits. Decide on day 31, not day 60. The answer
        compounds.
      </Body>

      <Callout label="What to keep, after the playbook">
        Three habits. The runbook gets updated when something breaks. The
        decision log gets a line every time something is chosen again. The press
        is the answer to <em>I don&rsquo;t know</em>. Used together, the system
        stays operable.
      </Callout>
    </ArticleShell>
  );
}
