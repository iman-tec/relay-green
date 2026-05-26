import Link from "next/link";
import { TryRelayButton } from "./TryRelayButton";
import { RelayLogo } from "./RelayLogo";

/*
 * Shared dark CTA banner. Single source of truth so the same block can't
 * drift across Home / product / pricing / resources — the surfaces that
 * previously had near-identical inline copies of this section. The
 * default content is the canonical brand closer; `heading`, `promises`,
 * and `actions` are escape hatches when a page needs different copy.
 *
 * Design intent: rather than a paragraph of prose, the lede is now a
 * three-pillar "promise" row that mirrors the brand's structural
 * vocabulary (numbered phases, three-leg cards, six-step strip). Each
 * pillar carries a mono numeral, a strong short label, and a serif
 * supporting line. The pillar grid stacks to a single column on mobile.
 */

type Promise = {
  label: string;
  supporting: string;
};

const DEFAULT_PROMISES: Promise[] = [
  { label: "In seconds.", supporting: "A real engineer joins your build." },
  { label: "To launch.", supporting: "Same engineer takes you through." },
  { label: "And beyond.", supporting: "Same engineer keeps it running." },
];

export function CtaBanner({
  heading,
  promises,
  actions,
}: {
  heading?: React.ReactNode;
  promises?: Promise[];
  actions?: React.ReactNode;
}) {
  const promiseList = promises ?? DEFAULT_PROMISES;
  return (
    <section className="r-cta-banner">
      <div className="r-wrap-narrow">
        <h2 className="r-cta-banner-heading">
          {heading ?? (
            <>
              AI changed <em>who</em> can build.
              <br />
              <RelayLogo size="0.82em" color="var(--text-on-dark)" /> changes{" "}
              <em>the way</em> they ship.
            </>
          )}
        </h2>
        <ol className="r-cta-banner-promises" aria-label="The Relay promise">
          {promiseList.map((p, i) => (
            <li className="r-cta-banner-promise" key={p.label}>
              <span className="r-cta-banner-promise-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="r-cta-banner-promise-label">{p.label}</span>
              <span className="r-cta-banner-promise-supporting">
                {p.supporting}
              </span>
            </li>
          ))}
        </ol>
        <div className="r-cta-banner-actions">
          {actions ?? (
            <>
              <TryRelayButton />
              <Link
                href="/company/about#contact"
                className="r-btn r-btn-ghost r-cta-banner-ghost"
              >
                Talk to sales <span className="arrow">→</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
