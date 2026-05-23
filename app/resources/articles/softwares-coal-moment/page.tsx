/*
 * /resources/articles/softwares-coal-moment, Essay.
 */

import type { Metadata } from "next";
import { ArticleShell } from "../../_components/ArticleShell";
import { Body } from "../../_components/Body";
import { Pullquote } from "../../_components/Pullquote";
import { findPost } from "../../_data/posts";
import { metadataForPost } from "../../_data/post-metadata";

const post = findPost("articles", "softwares-coal-moment")!;

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
      ctaHeadlineHtml="More software.<br /><em>More engineers.</em>"
    >
      <Body>
        In the second half of the nineteenth century, the cost of coal fell
        sharply. Engines got better; mines got deeper; rail moved tonnage that
        used to move on river barges. Economists at the time made a confident
        prediction. Cheaper coal would mean less coal, the same heat, the same
        light, the same iron, for fewer tons in the ground.
      </Body>
      <Body>
        The opposite happened. Cheaper coal meant more coal. Cheaper coal made
        railroads, and railroads made cities, and cities made factories, and
        factories made everything else, and everything else needed coal. The ton
        of coal that fell in price in 1865 looked like a luxury saved. Twenty
        years later it looked like the precondition for a world that burned
        fifty times more of it. The economist William Stanley Jevons named the
        pattern. The price of a thing we use a lot of can fall, and consumption
        of that thing can rise faster than the price falls.
      </Body>
      <Body>We think software is having its coal moment.</Body>
      <Pullquote>
        Cheaper code does not mean less software. It means more software, and
        more of the work around the software.
      </Pullquote>
      <Body>
        The cost of writing a working line of code has fallen for two years now
        at the speed of model improvement. The fall is real. We have watched it
        inside our own customers&rsquo; sessions. A tool that took a contract
        engineer six weeks now takes a marketing manager eleven days. A working
        prototype that used to clear a quarter&rsquo;s engineering backlog now
        clears it on a Tuesday. The numbers are real; the productivity is real;
        the savings, in the narrow sense, are real.
      </Body>
      <Body>
        And then the demand curve moves. The marketing manager who wrote the
        tool finds three more tools she would like to write. The COO who saw the
        first one ship asks her to ship four more. The lawyer who heard about it
        has six. None of these tools would have been built before; they were not
        in any backlog; they did not justify a developer-month; they would have
        lived as a spreadsheet, or a Notion page, or a fact someone had to keep
        in their head. They exist now because the cost of making them fell below
        a threshold.
      </Body>
      <Body>
        Multiply that by every department in every company in every country. We
        are not in the early innings of a contraction in the demand for
        software. We are in the early innings of an expansion that will, in
        retrospect, look more like the rail boom than the cost-saving narrative
        ever predicted.
      </Body>
      <Body>
        The interesting question is what happens to engineers in that world.
      </Body>
      <Body>
        The naive prediction, the same prediction the nineteenth-century
        economists made about miners, is that engineers contract along with the
        price of code. They don&rsquo;t. The price of code is falling, but the
        work that surrounds the code is not falling at the same rate. Code that
        runs in production has to be reviewed, integrated, deployed, secured,
        observed, owned. Code that handles money or health information or
        someone&rsquo;s identity has to be defended. Code that breaks has to be
        fixed by somebody who can read it. The line of code is cheaper. The
        shipping of the line is not.
      </Body>
      <Body>
        Engineers, in the new world, do less line-writing and more
        line-shipping. The work is denser than the work it replaced. Reading a
        stranger&rsquo;s diff at 2pm and saying <em>this will hold, ship it</em>{" "}
        takes more skill, not less, than writing the diff would have taken.
        Reading a stranger&rsquo;s diff at 2pm and saying{" "}
        <em>
          this will not hold; here&rsquo;s why; here&rsquo;s what to do instead
        </em>{" "}
        takes more skill again. The software engineer of 2030 will write fewer
        lines than the software engineer of 2020. They will be responsible for
        more of them.
      </Body>
      <Body>
        We think this is the correct shape for the next decade. More software,
        written by more people, supported by more engineers per
        ton-of-code-shipped than the previous era ever needed. The bench, in our
        terms. The press. The relay. A software engineer one click away from the
        moment a person who isn&rsquo;t an engineer is about to ship something
        to a customer.
      </Body>
      <Body>
        The coal economists missed the boom because they were measuring the
        wrong thing. They were measuring tons-per-furnace, not
        furnaces-per-country. We think the people predicting the contraction of
        engineering are making the same mistake. They are measuring lines per
        engineer. They should measure systems per company, and people downstream
        of those systems, and the pace at which the next system gets built. By
        those measures, engineering is the largest growth sector of the next ten
        years.
      </Body>
      <Body>
        We are building Relay because we believe that. The price of writing
        software fell. The volume of software is going to rise faster than the
        price fell. The work in the gap, the human shipping the machine&rsquo;s
        output, is the work we are organizing the category around.
      </Body>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--ink-mute)",
          fontSize: 14,
          marginTop: 32,
        }}
      >
        The founders, May 2026.
      </p>
    </ArticleShell>
  );
}
