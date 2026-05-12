"use client";

/*
 * Relay 45-second animated explainer, v2.
 *
 * Leads with the WHY (AI changed who can build · the hard parts still need
 * a software engineer), then walks through the press, the Zoom session, the
 * three phases, and the closing press-joins-stays beat before the
 * end card.
 *
 * Voiceover plays through the browser's Web Speech API
 * (SpeechSynthesisUtterance), works in Chrome / Edge / Safari without any
 * dependencies. A mute toggle is exposed in the controls.
 *
 * Screen-record this in a tab to produce a clean MP4 with audio
 * (macOS Cmd+Shift+5 with mic option, Windows Game Bar, OBS).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const TOTAL = 45; // seconds

type Scene = {
  start: number;
  end: number;
  vo?: string;
  render: (elapsed: number) => React.ReactNode;
};

const FADE = 0.5;
function sceneOpacity(elapsed: number, start: number, end: number): number {
  if (elapsed <= start - FADE || elapsed >= end + FADE) return 0;
  if (elapsed < start) return (elapsed - (start - FADE)) / FADE;
  if (elapsed > end) return 1 - (elapsed - end) / FADE;
  return 1;
}

function localProgress(elapsed: number, start: number, end: number): number {
  if (elapsed < start) return 0;
  if (elapsed > end) return 1;
  return (elapsed - start) / (end - start);
}

const scenes: Scene[] = [
  // ───── Beat 1 · WHY (0:00–0:06)
  {
    start: 0,
    end: 6,
    vo: "AI changed who can build software. The hard parts still want a software engineer.",
    render: (e) => (
      <CenteredScene>
        <WhyVisual progress={localProgress(e, 0, 5)} />
        <SceneTitle>
          AI changed <em>who</em> can build.
          <br />
          The hard parts still want a <em>person.</em>
        </SceneTitle>
      </CenteredScene>
    ),
  },

  // ───── Beat 2 · The wall (0:06–0:13)
  {
    start: 6,
    end: 13,
    vo: "Architecture, security, deployment, maintenance, the ninety percent behind the curtain.",
    render: (e) => (
      <CenteredScene>
        <FourMoments progress={localProgress(e, 6, 12)} />
        <SceneCaption italic>
          Architecture. Security. Deployment. Maintenance.
        </SceneCaption>
      </CenteredScene>
    ),
  },

  // ───── Beat 3 · The press (0:13–0:18)
  {
    start: 13,
    end: 18,
    vo: "Press the green dot. A software engineer joins.",
    render: () => (
      <CenteredScene>
        <PressPanel />
        <SceneTitle>
          Press the <em>green dot.</em>
        </SceneTitle>
      </CenteredScene>
    ),
  },

  // ───── Beat 4 · Zoom session (0:18–0:26)
  {
    start: 18,
    end: 26,
    vo: "A software engineer enters your live session, on Zoom you already use.",
    render: (e) => (
      <CenteredScene>
        <ZoomInterface progress={localProgress(e, 18, 25)} />
        <SceneCaption italic>
          A live Zoom session, on the platform your team already uses.
        </SceneCaption>
      </CenteredScene>
    ),
  },

  // ───── Beat 5 · Three phases (0:26–0:33)
  {
    start: 26,
    end: 33,
    vo: "Build. Launch. Maintain. Same team, end to end.",
    render: (e) => (
      <CenteredScene>
        <PhaseTrack progress={localProgress(e, 26, 32)} />
        <SceneTitle>
          Build. Launch. Maintain.
          <br />
          <em>Same team.</em>
        </SceneTitle>
      </CenteredScene>
    ),
  },

  // ───── Beat 6 · Brand backbone (0:33–0:40)
  {
    start: 33,
    end: 40,
    vo: "One press. An engineer joins. The same engineer stays with you.",
    render: (e) => (
      <CenteredScene>
        <BackboneStats progress={localProgress(e, 33, 39)} />
      </CenteredScene>
    ),
  },

  // ───── Beat 7 · End card (0:40–0:45)
  {
    start: 40,
    end: 45,
    vo: "Build with AI. Ship with engineers. Relay.",
    render: (e) => (
      <CenteredScene>
        <EndCard progress={localProgress(e, 40, 44)} />
      </CenteredScene>
    ),
  },
];

export function ExplainerVideo() {
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const lastRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const spokenRef = useRef<Set<number>>(new Set());

  // Cancel any in-flight VO whenever we pause / restart / unmount.
  const cancelVO = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // Speak a scene's VO line, lazy-pick the first English voice we find.
  const speakScene = useCallback(
    (sceneIndex: number) => {
      if (muted) return;
      if (spokenRef.current.has(sceneIndex)) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window))
        return;
      const text = scenes[sceneIndex]?.vo;
      if (!text) return;
      spokenRef.current.add(sceneIndex);
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 0.95;
      u.volume = 1;
      // Prefer an English voice; SpeechSynthesis may have a slight async
      // load on first call, getVoices() returns [] briefly. Fall back to
      // the engine default if so.
      const voices = window.speechSynthesis.getVoices();
      const en = voices.find(
        (v) =>
          /en[-_]?US/i.test(v.lang) ||
          /en[-_]?GB/i.test(v.lang) ||
          /english/i.test(v.name)
      );
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    },
    [muted]
  );

  // RAF timeline driver
  useEffect(() => {
    if (!isPlaying) {
      lastRef.current = null;
      return;
    }
    const tick = (now: number) => {
      const dt = lastRef.current === null ? 0 : (now - lastRef.current) / 1000;
      lastRef.current = now;
      setElapsed((prev) => {
        const next = prev + dt;
        // Speak scene VO at the moment its scene becomes "active"
        scenes.forEach((scene, i) => {
          if (
            !spokenRef.current.has(i) &&
            prev < scene.start &&
            next >= scene.start
          ) {
            speakScene(i);
          }
        });
        if (next >= TOTAL) {
          setIsPlaying(false);
          return TOTAL;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speakScene]);

  // Stop talking on unmount
  useEffect(() => () => cancelVO(), [cancelVO]);

  const handlePlay = useCallback(() => {
    if (elapsed >= TOTAL) {
      setElapsed(0);
      spokenRef.current.clear();
    }
    // Speak the first scene's VO immediately on play (it starts at t=0,
    // so the boundary-crossing logic above wouldn't catch it).
    if (elapsed === 0) speakScene(0);
    setIsPlaying(true);
  }, [elapsed, speakScene]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    cancelVO();
  }, [cancelVO]);

  const handleRestart = useCallback(() => {
    cancelVO();
    setElapsed(0);
    spokenRef.current.clear();
    speakScene(0);
    setIsPlaying(true);
  }, [cancelVO, speakScene]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (!m) cancelVO();
      return !m;
    });
  }, [cancelVO]);

  const overlayVisible = !isPlaying && elapsed === 0;
  const finishedOverlay = !isPlaying && elapsed >= TOTAL;

  return (
    <div className="explainer-root" data-elapsed={Math.round(elapsed * 10)}>
      <style>{`
        .explainer-root {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: var(--cream, #f4f2ee);
          color: var(--ink, #1a1814);
          border-radius: 14px;
          overflow: hidden;
          font-family: var(--font-inter, system-ui), system-ui, sans-serif;
          isolation: isolate;
        }
        .explainer-stage { position: absolute; inset: 0; }
        .explainer-scene {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .explainer-overlay {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(20, 20, 19, 0.5);
          backdrop-filter: blur(2px);
          z-index: 5;
        }
        .explainer-play-btn {
          width: 84px; height: 84px;
          border-radius: 50%;
          background: var(--cream, #f4f2ee);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 14px 48px rgba(0,0,0,0.35);
          transition: transform 0.2s ease;
        }
        .explainer-play-btn:hover { transform: scale(1.06); }
        .explainer-play-btn .triangle {
          width: 0; height: 0; margin-left: 7px;
          border-left: 22px solid var(--ink, #1a1814);
          border-top: 14px solid transparent;
          border-bottom: 14px solid transparent;
        }
        .explainer-controls {
          position: absolute; left: 18px; right: 18px; bottom: 16px;
          display: flex; align-items: center; gap: 12px;
          z-index: 4;
        }
        .explainer-control-btn {
          appearance: none;
          background: rgba(20,20,19,0.7);
          border: 1px solid rgba(244,242,238,0.2);
          color: var(--cream, #f4f2ee);
          width: 32px; height: 32px;
          border-radius: 50%;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          padding: 0; transition: background 0.15s ease;
        }
        .explainer-control-btn:hover { background: rgba(20,20,19,0.85); }
        .explainer-control-btn[aria-pressed="true"] {
          background: var(--green-deep, #3f5c2e);
          border-color: var(--green-deep, #3f5c2e);
        }
        .explainer-progress {
          flex: 1; height: 3px;
          background: rgba(20,20,19,0.15);
          border-radius: 2px; overflow: hidden;
        }
        .explainer-progress-fill {
          height: 100%;
          background: var(--green, #4f6b3a);
          transition: width 0.15s linear;
        }
        .explainer-time {
          font-family: var(--font-jetbrains, monospace);
          font-size: 11px;
          color: rgba(20,20,19,0.55);
          letter-spacing: 0.04em;
          min-width: 56px; text-align: right;
        }
        .explainer-corner-dot {
          position: absolute; top: 18px; right: 22px;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--green, #4f6b3a);
          z-index: 3;
        }
        .explainer-corner-dot::after {
          content: "";
          position: absolute; inset: -3px;
          border-radius: 50%;
          background: var(--green, #4f6b3a);
          opacity: 0.5;
          animation: explainer-pulse 2.4s cubic-bezier(0.2,0.7,0.2,1) infinite;
        }
        @keyframes explainer-pulse {
          0%,100% { transform: scale(1); opacity: 0.5; }
          50%     { transform: scale(1.7); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .explainer-corner-dot::after { animation: none; opacity: 0; }
        }
      `}</style>

      <span className="explainer-corner-dot" aria-hidden="true"></span>

      <div className="explainer-stage">
        {scenes.map((scene, i) => {
          const o = sceneOpacity(elapsed, scene.start, scene.end);
          if (o === 0) return null;
          return (
            <div
              key={i}
              className="explainer-scene"
              style={{ opacity: o, transition: "opacity 0.2s linear" }}
            >
              {scene.render(elapsed)}
            </div>
          );
        })}
      </div>

      {overlayVisible && (
        <div className="explainer-overlay">
          <button
            type="button"
            className="explainer-play-btn"
            aria-label="Play the Relay 45-second explainer"
            onClick={handlePlay}
          >
            <span className="triangle"></span>
          </button>
        </div>
      )}

      {finishedOverlay && (
        <div
          className="explainer-overlay"
          style={{
            background: "rgba(244,242,238,0.92)",
            backdropFilter: "none",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-source-serif, serif)",
                fontSize: "clamp(28px, 3.4vw, 44px)",
                letterSpacing: "-0.018em",
                marginBottom: 16,
                color: "var(--ink, #1a1814)",
              }}
            >
              Build with AI. Ship with{" "}
              <em style={{ color: "var(--green-deep, #3f5c2e)" }}>
                engineers.
              </em>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleRestart}
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "var(--ink, #1a1814)",
                  color: "var(--cream, #f4f2ee)",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                ↻ Replay
              </button>
              <Link
                href="/"
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "var(--green, #4f6b3a)",
                  color: "var(--cream, #f4f2ee)",
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Visit relay.green →
              </Link>
            </div>
          </div>
        </div>
      )}

      {!overlayVisible && !finishedOverlay && (
        <div className="explainer-controls">
          <button
            type="button"
            className="explainer-control-btn"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={isPlaying ? handlePause : handlePlay}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="explainer-control-btn"
            aria-label={muted ? "Unmute voice-over" : "Mute voice-over"}
            aria-pressed={muted}
            onClick={toggleMute}
          >
            {muted ? <SpeakerMutedIcon /> : <SpeakerIcon />}
          </button>
          <div className="explainer-progress">
            <div
              className="explainer-progress-fill"
              style={{ width: `${(elapsed / TOTAL) * 100}%` }}
            ></div>
          </div>
          <div className="explainer-time">
            {formatTime(elapsed)} / {formatTime(TOTAL)}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ───────── Control icons ───────── */

function PlayIcon() {
  return (
    <span
      style={{
        width: 0,
        height: 0,
        marginLeft: 2,
        borderLeft: "8px solid currentColor",
        borderTop: "5px solid transparent",
        borderBottom: "5px solid transparent",
      }}
    ></span>
  );
}
function PauseIcon() {
  return (
    <span style={{ display: "flex", gap: 3 }}>
      <span style={{ width: 3, height: 12, background: "currentColor" }}></span>
      <span style={{ width: 3, height: 12, background: "currentColor" }}></span>
    </span>
  );
}
function SpeakerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a4 4 0 0 1 0 7M18.5 5.5a8 8 0 0 1 0 13" />
    </svg>
  );
}
function SpeakerMutedIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </svg>
  );
}

/* ───────── Scene primitives ───────── */

function CenteredScene({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "44px 56px 80px",
      }}
    >
      {children}
    </div>
  );
}

function SceneCaption({
  italic = false,
  children,
}: {
  italic?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-source-serif, Georgia, serif)",
        fontStyle: italic ? "italic" : "normal",
        fontSize: "clamp(16px, 1.6vw, 22px)",
        lineHeight: 1.4,
        color: "var(--ink, #1a1814)",
        maxWidth: "60ch",
        textAlign: "center",
        letterSpacing: "-0.005em",
      }}
    >
      {children}
    </div>
  );
}

function SceneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-source-serif, Georgia, serif)",
        fontWeight: 400,
        fontSize: "clamp(28px, 4.2vw, 56px)",
        letterSpacing: "-0.022em",
        lineHeight: 1.05,
        margin: 0,
        textAlign: "center",
        color: "var(--ink, #1a1814)",
      }}
    >
      {children}
      <style>{`h2 em { font-style: italic; color: var(--green-deep, #3f5c2e); }`}</style>
    </h2>
  );
}

function MonoTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains, monospace)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-mute, #8a857c)",
      }}
    >
      {children}
    </span>
  );
}

/* ───────── Beat 1 · WHY visual, AI-symbol → person silhouette ───────── */

function WhyVisual({ progress }: { progress: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 56,
      }}
    >
      {/* AI sigil, abstract grid of dots */}
      <div
        style={{
          width: 80,
          height: 80,
          background: "var(--paper, #f9f7f3)",
          border: "1px solid var(--rule, #d8d2c5)",
          borderRadius: 14,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          padding: 14,
          opacity: 1 - progress * 0.4,
          transition: "opacity 0.4s",
        }}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              borderRadius: 3,
              background:
                i === 4 ? "var(--green, #4f6b3a)" : "var(--rule, #d8d2c5)",
              opacity: i === 4 ? 1 : 0.5 + Math.sin(progress * 8 + i) * 0.3,
              transition: "opacity 0.3s",
            }}
          ></span>
        ))}
      </div>

      {/* Arrow */}
      <span
        style={{
          fontSize: 28,
          color: "var(--ink-soft, #4a4640)",
          opacity: progress,
          transform: `translateX(${(1 - progress) * -8}px)`,
          transition: "opacity 0.4s, transform 0.4s",
        }}
      >
        →
      </span>

      {/* Anonymous human silhouette */}
      <div
        style={{
          width: 80,
          height: 80,
          background: "var(--paper, #f9f7f3)",
          border: "1px solid var(--green-deep, #3f5c2e)",
          borderRadius: 14,
          position: "relative",
          overflow: "hidden",
          opacity: 0.4 + progress * 0.6,
          transition: "opacity 0.4s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--ink-soft, #4a4640)",
          }}
        ></span>
        <span
          style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 56,
            height: 36,
            background: "var(--ink-soft, #4a4640)",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
          }}
        ></span>
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--green, #4f6b3a)",
            border: "2px solid var(--paper, #f9f7f3)",
          }}
        ></span>
      </div>
    </div>
  );
}

/* ───────── Beat 2 · Four moments ───────── */

function FourMoments({ progress }: { progress: number }) {
  const items = [
    { label: "Architecture", color: "rgba(79,107,58,0.15)" },
    { label: "Security", color: "rgba(204,120,92,0.18)" },
    { label: "Deployment", color: "rgba(79,107,58,0.10)" },
    { label: "Maintenance", color: "rgba(204,120,92,0.12)" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        width: "min(720px, 88%)",
      }}
    >
      {items.map((item, i) => {
        const itemProgress = Math.max(0, Math.min(1, progress * 4 - i));
        return (
          <div
            key={item.label}
            style={{
              padding: "20px 16px",
              background: "var(--paper, #f9f7f3)",
              border: `1px solid ${
                itemProgress > 0.5
                  ? "var(--green-deep, #3f5c2e)"
                  : "var(--rule, #d8d2c5)"
              }`,
              borderRadius: 10,
              textAlign: "center",
              opacity: itemProgress,
              transform: `translateY(${(1 - itemProgress) * 12}px)`,
              transition:
                "opacity 0.4s cubic-bezier(0.2,0.7,0.2,1), transform 0.4s cubic-bezier(0.2,0.7,0.2,1), border-color 0.3s",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background: item.color,
                opacity: itemProgress > 0.7 ? 1 : 0,
                transition: "opacity 0.4s",
              }}
            ></span>
            <div
              style={{
                position: "relative",
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 10,
                color: "var(--ink-mute, #8a857c)",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </div>
            <div
              style={{
                position: "relative",
                fontFamily: "var(--font-source-serif, serif)",
                fontSize: 18,
                color: "var(--ink, #1a1814)",
                letterSpacing: "-0.01em",
              }}
            >
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── Beat 3 · Press panel ───────── */

function PressPanel() {
  return (
    <div
      style={{
        background: "var(--paper, #f9f7f3)",
        border: "1px solid var(--rule, #d8d2c5)",
        borderRadius: 12,
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 14px 50px rgba(20,20,19,0.10)",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--green, #4f6b3a)",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: -5,
            borderRadius: "50%",
            background: "var(--green, #4f6b3a)",
            opacity: 0.5,
            animation:
              "explainer-pulse 1.4s cubic-bezier(0.2,0.7,0.2,1) infinite",
          }}
        ></span>
      </span>
      <span
        style={{
          fontFamily: "var(--font-inter, system-ui), system-ui",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink, #1a1814)",
        }}
      >
        Press for an engineer →
      </span>
    </div>
  );
}

/* ───────── Beat 4 · Zoom interface ───────── */

function ZoomInterface({ progress }: { progress: number }) {
  const isJoined = progress > 0.3;
  const seconds = Math.floor(progress * 7);
  const sec = String(seconds).padStart(2, "0");
  return (
    <div
      style={{
        width: "min(760px, 88%)",
        background: "#1a1a1a",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(244,242,238,0.1)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.4)",
      }}
    >
      {/* Zoom-style top bar */}
      <div
        style={{
          padding: "10px 16px",
          background: "#202020",
          borderBottom: "1px solid #303030",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "var(--font-inter, system-ui), system-ui",
          fontSize: 11,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#5fb850",
              boxShadow: "0 0 6px rgba(95,184,80,0.6)",
            }}
          ></span>
          Relay session · 0:00:{sec}
        </span>
        <span
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span style={{ opacity: 0.6 }}>End-to-end encrypted</span>
          <span style={{ opacity: 0.4 }}>×</span>
        </span>
      </div>

      {/* Main video stage */}
      <div
        style={{
          aspectRatio: "16 / 7",
          background: "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)",
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 1,
          position: "relative",
        }}
      >
        {/* Engineer tile */}
        <div
          style={{
            background: "#252525",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Anonymous silhouette */}
          <div
            style={{
              position: "relative",
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #4a4640 0%, #2a2a2a 100%)",
              overflow: "hidden",
              opacity: isJoined ? 1 : 0.4,
              transform: `scale(${isJoined ? 1 : 0.85})`,
              transition: "opacity 0.5s, transform 0.5s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 22,
                left: "50%",
                transform: "translateX(-50%)",
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "rgba(244,242,238,0.5)",
              }}
            ></span>
            <span
              style={{
                position: "absolute",
                bottom: -8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 64,
                height: 40,
                background: "rgba(244,242,238,0.5)",
                borderTopLeftRadius: 32,
                borderTopRightRadius: 32,
              }}
            ></span>
          </div>
          {/* Name tag */}
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              padding: "4px 10px",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 4,
              fontFamily: "var(--font-inter, system-ui), system-ui",
              fontSize: 11,
              color: "rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#5fb850",
              }}
            ></span>
            Senior Relay engineer
          </div>
          {/* "Joining" → "Online" pill */}
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              padding: "3px 8px",
              background: isJoined
                ? "rgba(79,107,58,0.85)"
                : "rgba(204,120,92,0.7)",
              borderRadius: 999,
              fontFamily: "var(--font-jetbrains, monospace)",
              fontSize: 9,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#fff",
              transition: "background 0.4s",
            }}
          >
            {isJoined ? "Online" : "Joining"}
          </div>
        </div>

        {/* Builder tile (anonymous) */}
        <div
          style={{
            background: "#1e1e1e",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3a3530 0%, #1a1a1a 100%)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 14,
                left: "50%",
                transform: "translateX(-50%)",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "rgba(244,242,238,0.45)",
              }}
            ></span>
            <span
              style={{
                position: "absolute",
                bottom: -4,
                left: "50%",
                transform: "translateX(-50%)",
                width: 40,
                height: 24,
                background: "rgba(244,242,238,0.45)",
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
              }}
            ></span>
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              padding: "3px 8px",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 4,
              fontFamily: "var(--font-inter, system-ui), system-ui",
              fontSize: 10,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            You
          </div>
        </div>
      </div>

      {/* Zoom-style toolbar */}
      <div
        style={{
          padding: "10px 16px",
          background: "#171717",
          borderTop: "1px solid #303030",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        {[
          { label: "Mic", active: true },
          { label: "Video", active: true },
          { label: "Share", active: false },
          { label: "Chat", active: false },
          { label: "Record", active: true, accent: true },
        ].map((b) => (
          <span
            key={b.label}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              fontFamily: "var(--font-inter, system-ui), system-ui",
              fontSize: 10.5,
              letterSpacing: "0.02em",
              color: b.accent
                ? "#fff"
                : b.active
                  ? "rgba(255,255,255,0.85)"
                  : "rgba(255,255,255,0.5)",
              background: b.accent
                ? "rgba(79,107,58,0.85)"
                : "rgba(255,255,255,0.06)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {b.accent && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#fff",
                }}
              ></span>
            )}
            {b.label}
          </span>
        ))}
        <span
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            fontFamily: "var(--font-inter, system-ui), system-ui",
            fontSize: 10.5,
            color: "#fff",
            background: "#cc4040",
          }}
        >
          End
        </span>
      </div>
    </div>
  );
}

/* ───────── Beat 5 · Three phases track ───────── */

function PhaseTrack({ progress }: { progress: number }) {
  const phases = [
    { num: "01", title: "Build", role: "You build. AI supports." },
    { num: "02", title: "Launch", role: "Relay leads." },
    { num: "03", title: "Maintain", role: "Relay takes accountability." },
  ];
  return (
    <div
      style={{
        position: "relative",
        width: "min(760px, 92%)",
        padding: "20px 0",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 2,
          background: "var(--rule, #d8d2c5)",
        }}
      ></div>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          height: 2,
          width: `${Math.min(progress, 1) * 100}%`,
          background: "var(--green, #4f6b3a)",
          transition: "width 0.15s linear",
        }}
      ></div>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${Math.min(progress, 1) * 100}%`,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--green, #4f6b3a)",
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 4px rgba(79,107,58,0.18)",
          transition: "left 0.15s linear",
        }}
      ></div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          position: "relative",
        }}
      >
        {phases.map((p, i) => {
          const reachedAt = (i + 1) / phases.length;
          const reached = progress >= reachedAt - 0.1;
          return (
            <div
              key={p.num}
              style={{
                background: reached
                  ? "var(--paper, #f9f7f3)"
                  : "var(--cream, #f4f2ee)",
                border: `1px solid ${
                  reached
                    ? "var(--green-deep, #3f5c2e)"
                    : "var(--rule, #d8d2c5)"
                }`,
                borderRadius: 10,
                padding: "12px 14px",
                textAlign: "center",
                transition: "background 0.3s, border-color 0.3s",
              }}
            >
              <MonoTag>Phase {p.num}</MonoTag>
              <div
                style={{
                  fontFamily: "var(--font-source-serif, serif)",
                  fontSize: 17,
                  marginTop: 4,
                  color: "var(--ink, #1a1814)",
                }}
              >
                {p.title}
              </div>
              <div
                style={{
                  fontStyle: "italic",
                  fontFamily: "var(--font-source-serif, serif)",
                  fontSize: 11.5,
                  color: "var(--green-deep, #3f5c2e)",
                  marginTop: 2,
                }}
              >
                {p.role}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── Beat 6 · Backbone stats ───────── */

function BackboneStats({ progress }: { progress: number }) {
  const stats = [
    { num: "Press", label: "the dot" },
    { num: "Joins", label: "in seconds" },
    { num: "Stays", label: "build · launch · maintain" },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
      }}
    >
      <SceneTitle>
        Built on <em>operational depth.</em>
      </SceneTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          width: "min(820px, 92%)",
          background: "var(--ink, #1a1814)",
          borderRadius: 12,
          padding: "20px 0",
        }}
      >
        {stats.map((s, i) => {
          const itemProgress = Math.max(0, Math.min(1, progress * 5 - i));
          return (
            <div
              key={s.label}
              style={{
                padding: "8px 16px",
                borderRight:
                  i < stats.length - 1
                    ? "1px solid rgba(244,242,238,0.12)"
                    : "none",
                opacity: itemProgress,
                transform: `translateY(${(1 - itemProgress) * 8}px)`,
                transition:
                  "opacity 0.4s cubic-bezier(0.2,0.7,0.2,1), transform 0.4s cubic-bezier(0.2,0.7,0.2,1)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-source-serif, serif)",
                  fontSize: "clamp(24px, 3vw, 40px)",
                  lineHeight: 1,
                  color: "var(--cream, #f4f2ee)",
                  letterSpacing: "-0.022em",
                  marginBottom: 6,
                }}
              >
                {s.num}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains, monospace)",
                  fontSize: 9,
                  color: "rgba(244,242,238,0.55)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── Beat 7 · End card ───────── */

function EndCard({ progress }: { progress: number }) {
  const letters = "RELAY".split("");
  const visibleCount = Math.floor(progress * (letters.length + 2));
  return (
    <div
      style={{
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          fontFamily: "var(--font-inter, system-ui), system-ui",
          fontWeight: 500,
          fontSize: "clamp(54px, 9vw, 110px)",
          letterSpacing: "0.04em",
          color: "var(--ink, #1a1814)",
        }}
      >
        {letters.map((ch, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: i < visibleCount ? 1 : 0,
              transform: `translateY(${i < visibleCount ? 0 : 8}px)`,
              transition:
                "opacity 0.25s cubic-bezier(0.2,0.7,0.2,1), transform 0.25s cubic-bezier(0.2,0.7,0.2,1)",
            }}
          >
            {ch}
          </span>
        ))}
        <span
          style={{
            display: "inline-block",
            width: "0.66em",
            height: "0.66em",
            borderRadius: "50%",
            background: "var(--green, #4f6b3a)",
            marginLeft: "0.06em",
            transform: `scale(${visibleCount > letters.length ? 1 : 0.2})`,
            opacity: visibleCount > letters.length ? 1 : 0,
            transition:
              "opacity 0.3s cubic-bezier(0.2,0.7,0.2,1), transform 0.3s cubic-bezier(0.2,0.7,0.2,1)",
          }}
        ></span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-source-serif, serif)",
          fontStyle: "italic",
          fontSize: "clamp(18px, 2vw, 24px)",
          color: "var(--ink-soft, #4a4640)",
          opacity: visibleCount > letters.length + 1 ? 1 : 0,
          transition: "opacity 0.5s",
        }}
      >
        Build with AI. Ship with{" "}
        <span style={{ color: "var(--green-deep, #3f5c2e)" }}>engineers.</span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-jetbrains, monospace)",
          fontSize: 12,
          letterSpacing: "0.06em",
          color: "var(--ink-mute, #8a857c)",
          textTransform: "uppercase",
          opacity: visibleCount > letters.length + 1 ? 1 : 0,
          transition: "opacity 0.7s",
        }}
      >
        relay.green
      </div>
    </div>
  );
}
