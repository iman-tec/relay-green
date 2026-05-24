"use client";

/*
 * Client island for the "Three phases. One team." section. Renders the
 * .r-legs grid of phase cards.
 *
 * The cards are explainer-only — purchase happens inside the Try Relay
 * platform flow, not from these cards. Tier rows display name + detail +
 * price as static info (no longer clickable, no arrow). The closing
 * button on every card is the shared TryRelayButton, which opens the
 * Try Relay flow where the actual session-start + checkout lives.
 *
 * The standalone Enterprise card (rendered alongside this grid, not
 * inside it) keeps its own "Get in touch" CTA because enterprise sales
 * are quote-driven, not self-serve.
 */

import { plansForPhase, type Plan } from "./plans";

export type PhaseCard = {
  num: string;
  title: string;
  role: string;
  intro: string;
  phase: Plan["phase"];
  footnotes: string[];
  /** Retained on the type so callers don't break, even though we no
   *  longer route by topic. The Try Relay flow asks its own questions. */
  contactTopic: "build" | "launch" | "maintain";
};

type Props = { phases: PhaseCard[] };

export function PhaseCards({ phases }: Props) {
  return (
    <div className="r-legs">
      {phases.map((phase) => {
        const tiers = plansForPhase(phase.phase);

        return (
          <div className="r-leg" key={phase.num}>
            <div className="r-leg-num">{phase.num}</div>
            <h3 className="r-leg-title">{phase.title}</h3>
            <div className="r-leg-tag">
              <span className="mk-sweep">{phase.role}</span>
            </div>
            <p
              className="r-leg-desc"
              style={{ marginBottom: 20, flex: "0 0 auto" }}
            >
              {phase.intro}
            </p>

            {/* Static tier rows — info display only. No click handler,
                no arrow. Visual styling preserved via the same .r-leg-tier-row
                class; CSS hover/cursor states naturally become no-ops on
                a div. */}
            <div
              style={{ borderTop: "1px solid var(--rule)", flex: 1 }}
              role="list"
            >
              {tiers.map((plan) => (
                <div
                  key={plan.id}
                  role="listitem"
                  className="r-leg-tier-row r-leg-tier-row-static"
                >
                  <span className="r-leg-tier-text">
                    <span className="r-leg-tier-name">{plan.name}</span>
                    <span className="r-leg-tier-detail">{plan.detail}</span>
                  </span>
                  <span className="r-leg-tier-price">
                    {plan.priceLabel}
                  </span>
                </div>
              ))}
            </div>

            {phase.footnotes.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "16px 0 24px",
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  lineHeight: 1.5,
                }}
              >
                {phase.footnotes.map((note) => (
                  <li key={note} style={{ marginBottom: 2 }}>
                    * {note}
                  </li>
                ))}
              </ul>
            )}

            {/* No per-card CTA — a single Try Relay button lives below
                the entire grid in the parent layout. The cards are pure
                explainer; the Try Relay flow is the one buy-path. */}
          </div>
        );
      })}
    </div>
  );
}
