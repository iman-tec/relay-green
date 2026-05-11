"use client";

/*
 * The 6-frame "how it works" auto-advancing sequence from the design.
 * Auto-advances every 4.5s; clicking a step pins the user's choice and
 * cancels further auto-advance.
 */

import { useEffect, useRef, useState } from "react";

type Step = { num: string; label: string; title: string };

const STEPS: Step[] = [
  { num: "01", label: "Build", title: "AI takes you eighty percent of the way." },
  { num: "02", label: "Press", title: "You press the green dot." },
  {
    num: "03",
    label: "Match",
    title: "A senior engineer joins. By name. By face.",
  },
  {
    num: "04",
    label: "Solve",
    title: "Chat, voice, screen. They take it the rest of the way.",
  },
  { num: "05", label: "Baton", title: "Same engineer takes you to launch." },
  { num: "06", label: "Retain", title: "Same engineer keeps it running." },
];

export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pinned) return;
    timer.current = setTimeout(
      () => setStep((s) => (s + 1) % STEPS.length),
      4500
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, pinned]);

  const pickStep = (i: number) => {
    setPinned(true);
    setStep(i);
  };

  return (
    <>
      <div className="r-how-stage">
        <Frame
          active={step === 0}
          eyebrow="Frame 01 · The build moment"
          title={STEPS[0].title}
        >
          <div className="r-code-window" style={{ marginTop: 16 }}>
            <div className="head">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div>
              <span className="com"># Lovable build · webhook handler</span>
            </div>
            <div>
              <span className="key">POST</span>{" "}
              <span className="str">/webhooks/stripe</span>
            </div>
            <div>
              <span className="err">→ 401 Unauthorized</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <span className="com">
                # AI: “Try setting STRIPE_SECRET in env.”
              </span>
            </div>
            <div>
              <span className="com">
                # Want a senior engineer to take it from here.
              </span>
            </div>
          </div>
        </Frame>

        <Frame
          active={step === 1}
          eyebrow="Frame 02 · One press"
          title={STEPS[1].title}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
              marginTop: 24,
            }}
          >
            <button
              type="button"
              className="r-press-button"
              style={{ maxWidth: 320 }}
            >
              <span
                className="r-dot"
                style={{ ["--dot-size" as string]: "14px" }}
              ></span>
              Press for an engineer
            </button>
          </div>
          <div
            style={{
              textAlign: "center",
              fontSize: 13,
              color: "var(--ink-soft)",
            }}
          >
            One input. One engineer. One promise.
          </div>
        </Frame>

        <Frame
          active={step === 2}
          eyebrow="Frame 03 · The arrival"
          title={STEPS[2].title}
        >
          <div className="r-engineer-card" style={{ marginTop: 16 }}>
            <div className="r-engineer-avatar">
              P
              <span
                className="r-dot"
                style={{ ["--dot-size" as string]: "12px" }}
              ></span>
            </div>
            <div className="r-engineer-info">
              <div className="r-engineer-name">Priya R. · 4 yrs Stripe</div>
              <div className="r-engineer-status">
                <span
                  className="r-dot"
                  style={{ ["--dot-size" as string]: "6px" }}
                ></span>
                Online · joined in 71s
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--ink-soft)",
            }}
          >
            Engineer face & name visible <em>before</em> any commitment. No
            bait-and-switch.
          </div>
        </Frame>

        <Frame
          active={step === 3}
          eyebrow="Frame 04 · The session"
          title={STEPS[3].title}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 12,
            }}
          >
            <div className="r-chat-message">
              Stripe webhook 401s in prod. Works locally.
            </div>
            <div className="r-chat-message from-engineer">
              Got it — your prod endpoint just needs the signing secret. Want
              to share screen so I can show you?
            </div>
            <div className="r-chat-message">yes please</div>
            <div className="r-chat-message from-engineer">
              Done. Settings → Developers → Webhooks → reveal signing secret.
              Paste into STRIPE_WEBHOOK_SECRET. Redeploy.
            </div>
          </div>
        </Frame>

        <Frame
          active={step === 4}
          eyebrow="Frame 05 · Pass the baton"
          title={STEPS[4].title}
        >
          <div
            style={{
              marginTop: 16,
              padding: 18,
              background: "var(--green-tint)",
              border: "1px solid rgba(46,168,79,0.3)",
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "var(--green-deep)",
                marginBottom: 8,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              From Priya · 0:18
            </div>
            <div
              style={{
                fontSize: 15,
                color: "var(--ink)",
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              Want me to take this one to launch? Same — me. ~5 days.{" "}
              <strong>€2,400 fixed.</strong>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-soft)",
                marginBottom: 16,
              }}
            >
              HubSpot connected · Domain set up · Stripe live keys
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="r-btn r-btn-green"
                style={{ height: 36 }}
              >
                Pass the baton
              </button>
              <button
                type="button"
                className="r-btn r-btn-ghost"
                style={{ height: 36 }}
              >
                See scope
              </button>
              <button
                type="button"
                className="r-btn r-btn-ghost"
                style={{ height: 36 }}
              >
                Not yet
              </button>
            </div>
          </div>
        </Frame>

        <Frame
          active={step === 5}
          eyebrow="Frame 06 · The retainer"
          title={STEPS[5].title}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginTop: 16,
            }}
          >
            {[
              { k: "Same engineer", v: "Priya R." },
              { k: "SLA", v: "P1 · 4hr · 24/7" },
              { k: "Monthly retainer", v: "€2,800" },
              { k: "Quarterly review", v: "Architecture + roadmap" },
            ].map((row) => (
              <div
                key={row.k}
                style={{
                  padding: 14,
                  background: "var(--cream)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-mute)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  {row.k}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--ink)",
                    fontWeight: 500,
                  }}
                >
                  {row.v}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 13,
              color: "var(--green-deep)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              className="r-dot r-dot-static"
              style={{ ["--dot-size" as string]: "6px" }}
            ></span>{" "}
            Continuity discount applied automatically.
          </div>
        </Frame>
      </div>

      <div className="r-how-controls">
        {STEPS.map((s, i) => (
          <button
            key={s.num}
            type="button"
            className={"r-how-step" + (step === i ? " active" : "")}
            onClick={() => pickStep(i)}
          >
            <span className="num">{s.num}</span>
            <span className="label">{s.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Frame({
  active,
  title,
  children,
}: {
  active: boolean;
  /** Optional eyebrow label — accepted for API compatibility but no longer rendered. */
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"r-how-frame" + (active ? " active" : "")}>
      <h3 className="r-h-2" style={{ maxWidth: "24ch" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}
