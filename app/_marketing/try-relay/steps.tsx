"use client";

/*
 * Five step components for the Try Relay wizard, exported individually
 * and rendered by TryRelayWizard's switch on the current step. Each
 * step is a presentation component — state lives in the parent.
 */

import {
  NEEDS,
  STACK_GROUPS,
  TIMELINES,
  primaryStackLabel,
  pickEngineer,
  type Engineer,
  type Need,
  type Timeline,
  type WizardSnapshot,
} from "./data";

/* ---------- Shared UI bits ---------- */

function StepChip({ children }: { children: React.ReactNode }) {
  return <div className="r-tw-chip">{children}</div>;
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="r-tw-heading">{children}</h2>;
}

function StepSubcopy({ children }: { children: React.ReactNode }) {
  return <p className="r-tw-subcopy">{children}</p>;
}

function FooterButton({
  variant,
  disabled,
  onClick,
  children,
}: {
  variant: "primary" | "ghost";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`r-tw-btn r-tw-btn-${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Step 1: Need ---------- */

export function StepNeed({
  selected,
  onSelect,
  onContinue,
}: {
  selected: Need | null;
  onSelect: (id: Need) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <StepChip>Question 1 of 3</StepChip>
      <StepHeading>
        What do you <em>need right now?</em>
      </StepHeading>
      <StepSubcopy>
        We match you with the right engineer based on where you are in your
        build.
      </StepSubcopy>

      <ul className="r-tw-radio-list" role="radiogroup" aria-label="Your need">
        {NEEDS.map((opt) => {
          const isOn = selected === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                className={`r-tw-radio-card${isOn ? " is-on" : ""}`}
                role="radio"
                aria-checked={isOn}
                onClick={() => onSelect(opt.id)}
              >
                <span
                  className="r-tw-radio-dot"
                  aria-hidden="true"
                />
                <span className="r-tw-radio-body">
                  <span className="r-tw-radio-title">
                    <span aria-hidden="true">{opt.icon}</span> {opt.title}
                  </span>
                  <span className="r-tw-radio-sub">{opt.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="r-tw-footer r-tw-footer-single">
        <FooterButton
          variant="primary"
          disabled={!selected}
          onClick={onContinue}
        >
          Continue <span aria-hidden="true">→</span>
        </FooterButton>
      </div>
    </>
  );
}

/* ---------- Step 2: Stack ---------- */

type StackState = {
  aiTool: string | null;
  backend: string[];
  frontend: string[];
};

export function StepStack({
  stack,
  onSelectAi,
  onToggleBackend,
  onToggleFrontend,
  onBack,
  onContinue,
}: {
  stack: StackState;
  onSelectAi: (value: string) => void;
  onToggleBackend: (value: string) => void;
  onToggleFrontend: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const canContinue = !!stack.aiTool;

  return (
    <>
      <StepChip>Question 2 of 3</StepChip>
      <StepHeading>
        What are you <em>building with?</em>
      </StepHeading>
      <StepSubcopy>
        We support 150+ integrations. Pick what matters, we&rsquo;ll match you
        with an engineer who&rsquo;s shipped on it.
      </StepSubcopy>

      <div className="r-tw-stack-groups">
        {STACK_GROUPS.map((group) => {
          const isSelected = (value: string) => {
            if (group.id === "aiTool") return stack.aiTool === value;
            if (group.id === "backend") return stack.backend.includes(value);
            return stack.frontend.includes(value);
          };
          const onToggle = (value: string) => {
            if (group.id === "aiTool") onSelectAi(value);
            else if (group.id === "backend") onToggleBackend(value);
            else onToggleFrontend(value);
          };
          return (
            <div key={group.id} className="r-tw-stack-group">
              <div className="r-tw-stack-group-label">{group.label}</div>
              <div className="r-tw-stack-chips">
                {group.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`r-tw-stack-chip${
                      isSelected(opt) ? " is-on" : ""
                    }`}
                    onClick={() => onToggle(opt)}
                    aria-pressed={isSelected(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="r-tw-footer r-tw-footer-pair">
        <FooterButton variant="ghost" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </FooterButton>
        <FooterButton
          variant="primary"
          disabled={!canContinue}
          onClick={onContinue}
        >
          Continue <span aria-hidden="true">→</span>
        </FooterButton>
      </div>
    </>
  );
}

/* ---------- Step 3: Timeline ---------- */

export function StepTimeline({
  selected,
  onSelect,
  onBack,
  onFind,
}: {
  selected: Timeline | null;
  onSelect: (id: Timeline) => void;
  onBack: () => void;
  onFind: () => void;
}) {
  return (
    <>
      <StepChip>Question 3 of 3</StepChip>
      <StepHeading>
        How <em>soon</em> do you need someone?
      </StepHeading>
      <StepSubcopy>
        Our engineers are available in seconds. But knowing your timeline helps
        us match better.
      </StepSubcopy>

      <ul
        className="r-tw-radio-list"
        role="radiogroup"
        aria-label="Your timeline"
      >
        {TIMELINES.map((opt) => {
          const isOn = selected === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                className={`r-tw-radio-card${isOn ? " is-on" : ""}`}
                role="radio"
                aria-checked={isOn}
                onClick={() => onSelect(opt.id)}
              >
                <span
                  className="r-tw-radio-dot"
                  aria-hidden="true"
                />
                <span className="r-tw-radio-body">
                  <span className="r-tw-radio-title">
                    {opt.pulse ? (
                      <span
                        className="r-tw-pulse-dot"
                        aria-hidden="true"
                      />
                    ) : (
                      <span aria-hidden="true">{opt.icon}</span>
                    )}
                    {opt.title}
                  </span>
                  <span className="r-tw-radio-sub">{opt.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="r-tw-footer r-tw-footer-pair">
        <FooterButton variant="ghost" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </FooterButton>
        <FooterButton
          variant="primary"
          disabled={!selected}
          onClick={onFind}
        >
          Find my engineer <span aria-hidden="true">✎</span>
        </FooterButton>
      </div>
    </>
  );
}

/* ---------- Step 4: Finding ---------- */

export function StepFinding({ snapshot }: { snapshot: WizardSnapshot }) {
  const ctx = primaryStackLabel(snapshot);
  return (
    <div className="r-tw-finding">
      <div className="r-tw-finding-spinner" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path
            d="M12 4v4M12 16v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4 12h4M16 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>
      <div className="r-tw-finding-title">Finding your engineer…</div>
      <div className="r-tw-finding-sub">
        Matching based on <strong>{ctx}</strong>
      </div>
    </div>
  );
}

/* ---------- Step 5: Match ---------- */

export function StepMatch({
  engineer,
  onStart,
}: {
  engineer: Engineer;
  onStart: () => void;
}) {
  const firstName = engineer.name.split(" ")[0];

  return (
    <div className="r-tw-match">
      <StepChip>Match found</StepChip>
      <h2 className="r-tw-match-heading">
        <em>{firstName}</em> is ready.
      </h2>
      <p className="r-tw-match-sub">
        {engineer.title} · {engineer.years} yrs · {engineer.skills.join(", ")}
      </p>

      <div className="r-tw-match-card">
        <div className="r-tw-match-card-head">
          <div className="r-tw-match-avatar" aria-hidden="true">
            {engineer.initials}
          </div>
          <div className="r-tw-match-card-info">
            <div className="r-tw-match-card-name">{engineer.name}</div>
            <div className="r-tw-match-card-avail">{engineer.availability}</div>
            <div className="r-tw-match-card-skills">
              {engineer.skills.map((s) => (
                <span key={s} className="r-tw-match-skill">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="r-tw-match-card-divider" />
        <div className="r-tw-match-pricing">
          <div className="r-tw-match-price-row">
            <div className="r-tw-match-price-label">
              First session
              <span className="r-tw-match-price-sub">
                10 minutes on us. No card required.
              </span>
            </div>
            <div className="r-tw-match-price-value">Free</div>
          </div>
          <div className="r-tw-match-price-row">
            <div className="r-tw-match-price-label">Base plan (100 min)</div>
            <div className="r-tw-match-price-value">€50</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="r-tw-start-cta"
        onClick={onStart}
      >
        <span className="r-tw-start-dot" aria-hidden="true" />
        Start session now <span aria-hidden="true">→</span>
      </button>
      <div className="r-tw-match-foot">Chat · Voice · Screen share, your choice</div>
    </div>
  );
}

/* Re-export the matcher so the parent can call it without an extra
 * import line — keeps the wizard's component file lean. */
export { pickEngineer };
