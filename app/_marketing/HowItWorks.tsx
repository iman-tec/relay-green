/*
 * "How it works" — six-beat journey visualization that sits directly below
 * the hero. A dotted green curve (single quadratic bezier from Press to
 * Maintain) sweeps left to right; six nodes lie on the curve at evenly-
 * spaced t values (0, 0.2, 0.4, 0.6, 0.8, 1.0) so they trace the wave
 * naturally. Each node has a label above; the four interior nodes also
 * carry a step number (02–05) below. The two endpoints (Press, Maintain)
 * are the bookends and intentionally not numbered.
 *
 * Pure SVG, no JS. Scales fluidly via viewBox/preserveAspectRatio. The
 * low-opacity outer ring on each node is a halo for depth on dark bg.
 */

type Step = {
  label: string;
  x: number;
  y: number;
  num: string | null;
};

const STEPS: Step[] = [
  { label: "Press", x: 60, y: 200, num: null },
  { label: "Match", x: 277, y: 121, num: "02" },
  { label: "Join", x: 495, y: 83, num: "03" },
  { label: "Solve", x: 715, y: 87, num: "04" },
  { label: "Ship", x: 937, y: 133, num: "05" },
  { label: "Maintain", x: 1160, y: 220, num: null },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      style={{
        background: "#06090a",
        padding: "clamp(40px, 5vw, 72px) 0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "0 24px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--green)",
              marginBottom: 12,
            }}
          >
            How it works
          </div>
          <h2
            id="how-it-works-heading"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(26px, 3vw, 38px)",
              fontWeight: 400,
              color: "var(--text-on-dark)",
              lineHeight: 1.2,
              margin: 0,
              letterSpacing: "-0.015em",
            }}
          >
            Six beats. From a stuck moment to a shipped product.
          </h2>
        </div>

        <svg
          viewBox="0 0 1220 240"
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            overflow: "visible",
          }}
          role="img"
          aria-label="Relay journey: Press, Match, Join, Solve, Ship, Maintain"
        >
          {/* Dotted wave: single quadratic bezier from Press to Maintain.
              Control point (600, -50) creates the arc peak around y=80.
              The .mk-journey-path class animates stroke-dashoffset so the
              dashes flow L→R, reinforcing the journey direction. */}
          <path
            className="mk-journey-path"
            d="M 60 200 Q 600 -50 1160 220"
            fill="none"
            stroke="var(--green)"
            strokeWidth="3.5"
            strokeDasharray="3 11"
            strokeLinecap="round"
            opacity="0.65"
          />

          {STEPS.map((s) => (
            <g key={s.label} transform={`translate(${s.x}, ${s.y})`}>
              <circle
                className="mk-journey-aura"
                r="22"
                fill="var(--green)"
                opacity="0.18"
              />
              <circle
                className="mk-journey-dot"
                r="11"
                fill="var(--green)"
              />
              <text
                y="-28"
                textAnchor="middle"
                fontFamily="var(--font-sans)"
                fontSize="15"
                fontWeight="600"
                fill="var(--text-on-dark)"
              >
                {s.label}
              </text>
              {s.num && (
                <text
                  y="40"
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize="11"
                  letterSpacing="2"
                  fill="rgba(244, 242, 238, 0.4)"
                >
                  {s.num}
                </text>
              )}
            </g>
          ))}

          {/* Direction arrows — one between each pair of adjacent nodes
              (5 total). Positions and rotations are pre-computed at the
              midpoint t-values (0.1, 0.3, 0.5, 0.7, 0.9) of the bezier
              and tangent angles at those points. Rendered AFTER step
              <g>s so they sit on top of the flowing path. */}
          {[
            { x: 168, y: 155, angle: -20 },
            { x: 386, y: 97, angle: -10 },
            { x: 605, y: 80, angle: 1 },
            { x: 826, y: 105, angle: 12 },
            { x: 1048, y: 171, angle: 22 },
          ].map((a, i) => (
            <g
              key={i}
              transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
            >
              <polygon
                points="0,-6 12,0 0,6"
                fill="var(--green)"
                opacity="0.9"
              />
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
