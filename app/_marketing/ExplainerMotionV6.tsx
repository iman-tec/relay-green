"use client";

/*
 * Motion-graphic explainer v6 (Approach B).
 *
 * An in-browser editorial cut driven by a single audio file. All visual
 * content cross-fades by beat against the playhead time of the audio element,
 * so swapping the AI voiceover for a real human recording is a one-file drop
 * (see `relay-green/scripts/build-explainer-v6.ts --vo human`).
 *
 * The whole thing renders inside the marketing `mk-root` scope so brand
 * tokens (`--cream`, `--ink`, `--green`) and the `r-mark-dot` pulse animation
 * (non-negotiable per brand rule) just work without extra wiring.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { BEATS, TOTAL_DURATION, type Beat } from "./explainer-v6-beats";
import { RelayLogo } from "./RelayLogo";

const PHASES = [
  { id: "01", label: "Build", role: "You build. Your engineer supports." },
  { id: "02", label: "Launch & Go-Live", role: "Your engineer leads." },
  { id: "03", label: "Maintain & Scale", role: "Your engineer takes accountability." },
] as const;

function findBeat(t: number): Beat {
  for (const b of BEATS) {
    if (t >= b.start && t < b.end) return b;
  }
  return BEATS[BEATS.length - 1];
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ExplainerMotionV6() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);

  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // RAF runs at 60fps in foreground and is what drives smooth scene
    // cross-fades. But RAF throttles to ~1Hz in backgrounded tabs, which
    // would freeze the visuals while audio kept playing. timeupdate +
    // seeked listeners are the safety net: they keep firing on user
    // interactions even when RAF is asleep, and on seek they immediately
    // jump the scene to match the new playhead.
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) setTime(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    const onTime = () => {
      const audio = audioRef.current;
      if (audio) setTime(audio.currentTime);
    };
    rafRef.current = requestAnimationFrame(tick);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("seeked", onTime);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("seeked", onTime);
    };
  }, []);

  const current = findBeat(time);
  const progress = Math.min(time / TOTAL_DURATION, 1);

  const handlePlayPause = () => {
    const a = audioRef.current;
    if (!a) return;
    setHasInteracted(true);
    if (a.paused) {
      // Restart cleanly if we reached the end.
      if (a.currentTime >= TOTAL_DURATION - 0.1) a.currentTime = 0;
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
    setTime(TOTAL_DURATION);
  };

  // Reduced-motion: show a static "engineer arrival" still and let the user
  // press play if they want audio. We don't auto-render the 11 scenes.
  if (reducedMotion && !hasInteracted) {
    return (
      <Frame>
        <StaticArrivalFrame onPlay={handlePlayPause} />
        <audio
          ref={audioRef}
          src="/audio/relay-vo-v6.wav"
          preload="metadata"
          onEnded={handleEnded}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <div style={SCENE_STAGE}>
        <Beat1Build active={current.id === "1-build"} />
        <Beat2Wall active={current.id === "2-wall"} />
        <Beat3Press active={current.id === "3-press"} />
        <Beat4Arrival active={current.id === "4-arrival"} />
        <Beat5Modalities active={current.id === "5-modalities"} />
        <Beat6Phases
          activeIndex={
            current.id === "6a-phase1" ? 0 :
            current.id === "6b-phase2" ? 1 :
            current.id === "6c-phase3" ? 2 :
            current.id === "6d-relay" ? 3 : -1
          }
        />
        <Beat7Trust active={current.id === "7-trust"} />
        <Beat8Close active={current.id === "8-close"} />
      </div>

      <CaptionTrack beat={current} />

      <Controls
        playing={playing}
        time={time}
        progress={progress}
        onPlayPause={handlePlayPause}
      />

      {!hasInteracted && (
        <button
          type="button"
          onClick={handlePlayPause}
          style={PLAY_OVERLAY}
          aria-label="Play 60-second explainer"
        >
          <span style={PLAY_OVERLAY_INNER}>
            <PlayIcon />
            <span style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(244,242,238,0.7)" }}>
              Play · 60s
            </span>
          </span>
        </button>
      )}

      <audio
        ref={audioRef}
        src="/audio/relay-vo-v6.wav"
        preload="auto"
        onEnded={handleEnded}
      />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Frame + chrome
// ---------------------------------------------------------------------------

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        maxHeight: 540,
        borderRadius: 12,
        background: "var(--ink)",
        color: "var(--cream)",
        overflow: "hidden",
        border: "1px solid rgba(244,242,238,0.08)",
      }}
      data-testid="explainer-motion-v6"
    >
      {children}
    </div>
  );
}

const SCENE_STAGE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
};

function Controls({
  playing, time, progress, onPlayPause,
}: {
  playing: boolean; time: number; progress: number; onPlayPause: () => void;
}) {
  return (
    <div style={CONTROLS_ROW}>
      <button
        type="button"
        onClick={onPlayPause}
        style={CONTROL_BTN}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div style={PROGRESS_TRACK}>
        <div
          style={{
            ...PROGRESS_FILL,
            transform: `scaleX(${progress})`,
          }}
        />
      </div>
      <span style={TIMECODE}>{fmtTime(time)} / 1:00</span>
    </div>
  );
}

function CaptionTrack({ beat }: { beat: Beat }) {
  if (!beat.vo) return null;
  return (
    <div style={CAPTION_TRACK} aria-live="polite">
      <span style={CAPTION_TEXT}>{beat.vo}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beat scenes — each is absolutely positioned and fades on `active`.
// ---------------------------------------------------------------------------

function Scene({
  active, children, style,
}: {
  active: boolean; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden={!active}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: active ? 1 : 0,
        transition: "opacity 360ms ease-out",
        pointerEvents: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Beat1Build({ active }: { active: boolean }) {
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <LaptopFrame>
          <CodeLine width="80%" delay={0} />
          <CodeLine width="62%" delay={120} />
          <CodeLine width="74%" delay={240} indent={16} />
          <CodeLine width="58%" delay={360} indent={16} />
          <CodeLine width="68%" delay={480} />
        </LaptopFrame>
        <Eyebrow>A marketing manager. A founder. An analyst. Building software with AI.</Eyebrow>
      </div>
    </Scene>
  );
}

function Beat2Wall({ active }: { active: boolean }) {
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <LaptopFrame>
          <CodeLine width="80%" delay={0} muted />
          <CodeLine width="62%" delay={0} muted />
          <div style={{ ...CODE_LINE_BASE, width: "70%", marginTop: 14 }}>
            <span style={{ color: "#c5604f", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {`→ 401 Unauthorized`}
            </span>
          </div>
          <div style={{ ...CODE_LINE_BASE, width: "30%" }}>
            <span style={{ color: "rgba(244,242,238,0.6)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              <BlinkingCursor />
            </span>
          </div>
        </LaptopFrame>
        <Mono>STUCK · STRIPE WEBHOOK · 401</Mono>
      </div>
    </Scene>
  );
}

function Beat3Press({ active }: { active: boolean }) {
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
        <BigPressDot active={active} />
        <Display italic deep>The press.</Display>
        <Mono fade>Press for an engineer</Mono>
      </div>
    </Scene>
  );
}

function Beat4Arrival({ active }: { active: boolean }) {
  return (
    <Scene active={active}>
      <EngineerCard active={active} />
    </Scene>
  );
}

function Beat5Modalities({ active }: { active: boolean }) {
  const triplet = ["Chat.", "Voice.", "Screen share."];
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          {triplet.map((label, i) => (
            <ModalityTile key={label} label={label} delay={i * 200} active={active} />
          ))}
        </div>
        <Eyebrow italic>One engineer.</Eyebrow>
      </div>
    </Scene>
  );
}

function Beat6Phases({ activeIndex }: { activeIndex: number }) {
  const active = activeIndex >= 0;
  const showRelayPayoff = activeIndex === 3;
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, width: "100%", padding: "0 32px" }}>
        <PhaseTrack activeIndex={activeIndex} />
        {showRelayPayoff && (
          <Display italic>Same engineer. End to end.</Display>
        )}
      </div>
    </Scene>
  );
}

function Beat7Trust({ active }: { active: boolean }) {
  return (
    <Scene active={active}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        <GlobalMesh />
        <Mono>GDPR · SOC 2 · PER-TENANT ISOLATION · DPA AVAILABLE</Mono>
      </div>
    </Scene>
  );
}

function Beat8Close({ active }: { active: boolean }) {
  return (
    <Scene active={active} style={{ background: "var(--cream)", color: "var(--ink)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <RelayLogo size={64} color="var(--ink)" />
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink)" }}>
          Build with AI. Ship with engineers.
        </span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-soft)" }}>
          relay.green
        </span>
      </div>
    </Scene>
  );
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

function LaptopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={LAPTOP_OUTER}>
      <div style={LAPTOP_BAR}>
        <span style={LAPTOP_DOT} />
        <span style={{ ...LAPTOP_DOT, background: "#e0c75c" }} />
        <span style={{ ...LAPTOP_DOT, background: "#7bc47f" }} />
      </div>
      <div style={LAPTOP_BODY}>{children}</div>
    </div>
  );
}

const CODE_LINE_BASE: React.CSSProperties = {
  height: 8,
  borderRadius: 3,
  marginBottom: 10,
  background: "rgba(244,242,238,0.18)",
  transition: "transform 240ms ease-out, opacity 240ms ease-out",
};

function CodeLine({
  width, delay = 0, indent = 0, muted = false,
}: { width: string; delay?: number; indent?: number; muted?: boolean }) {
  return (
    <div
      style={{
        ...CODE_LINE_BASE,
        width,
        marginLeft: indent,
        opacity: muted ? 0.35 : 0.85,
        animation: `r-code-in 320ms ease-out ${delay}ms both`,
      }}
    />
  );
}

function BlinkingCursor() {
  return <span style={{ animation: "r-blink 1s steps(2) infinite" }}>|</span>;
}

function BigPressDot({ active }: { active: boolean }) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: 84,
        height: 84,
        borderRadius: "50%",
        background: "var(--green)",
        transform: active ? "scale(1)" : "scale(0.85)",
        transition: "transform 480ms cubic-bezier(.2,.7,.2,1)",
        isolation: "isolate",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "var(--green)", opacity: 0.5,
          animation: "r-press-pulse 2.4s ease-out infinite",
          zIndex: -1,
        }}
      />
    </span>
  );
}

function EngineerCard({ active }: { active: boolean }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        transform: active ? "translateY(0)" : "translateY(20px)",
        opacity: active ? 1 : 0,
        transition: "transform 480ms cubic-bezier(.2,.7,.2,1), opacity 360ms ease-out",
      }}
    >
      <div style={{ position: "relative", width: 88, height: 88 }}>
        <div
          style={{
            width: 88, height: 88, borderRadius: "50%",
            background: "linear-gradient(135deg, #d8d2c5 0%, #a8a39a 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontStyle: "italic",
            fontSize: 36, color: "var(--ink)",
          }}
        >
          P
        </div>
        <span
          className="r-mark-dot"
          aria-hidden="true"
          style={{
            position: "absolute", right: 2, bottom: 2,
            width: 18, height: 18, border: "3px solid var(--ink)",
          }}
        />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, letterSpacing: "0.04em", color: "var(--cream)" }}>
          PRIYA R.
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(244,242,238,0.55)", marginTop: 4 }}>
          Software Engineer · Joined
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 20, color: "var(--cream)", marginTop: 8 }}>
        By name. By face. In your session.
      </div>
    </div>
  );
}

function ModalityTile({ label, delay, active }: { label: string; delay: number; active: boolean }) {
  return (
    <div
      style={{
        minWidth: 140,
        padding: "18px 22px",
        borderRadius: 10,
        border: "1px solid rgba(244,242,238,0.14)",
        background: "rgba(244,242,238,0.04)",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: 16,
        color: "var(--cream)",
        textAlign: "center",
        opacity: active ? 1 : 0,
        transform: active ? "translateY(0)" : "translateY(8px)",
        transition: `opacity 320ms ease-out ${delay}ms, transform 320ms ease-out ${delay}ms`,
      }}
    >
      {label}
    </div>
  );
}

function PhaseTrack({ activeIndex }: { activeIndex: number }) {
  const positionPct = activeIndex < 0 ? 0 : activeIndex >= PHASES.length ? 100 : (activeIndex / (PHASES.length - 1)) * 100;
  return (
    <div style={{ width: "100%", maxWidth: 720, position: "relative", padding: "20px 0" }}>
      <div style={{ position: "relative", height: 1, background: "rgba(244,242,238,0.18)" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", top: 0, left: 0, height: 1,
            width: `${positionPct}%`, background: "var(--green)",
            transition: "width 480ms ease-out",
          }}
        />
        <span
          aria-hidden="true"
          className="r-mark-dot"
          style={{
            position: "absolute", top: -7, left: `calc(${positionPct}% - 7px)`,
            width: 14, height: 14, transition: "left 480ms ease-out",
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 16, gap: 16 }}>
        {PHASES.map((p, i) => (
          <div key={p.id} style={{
            textAlign: i === 0 ? "left" : i === PHASES.length - 1 ? "right" : "center",
            opacity: activeIndex >= i ? 1 : 0.32,
            transition: "opacity 320ms ease-out",
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(244,242,238,0.6)" }}>
              Phase {p.id} · {p.label}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--cream)", marginTop: 6, lineHeight: 1.35 }}>
              {p.role}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GlobalMesh() {
  // Cream dots blinking across an ink field, evoking a follow-the-sun map.
  // Six dots arranged left-to-right with phased blinks via staggered delays.
  const dots = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    leftPct: 8 + (i * 84) / 5,
    topPct: 30 + (i % 2 === 0 ? 0 : 26),
    delay: i * 380,
  })), []);
  return (
    <div style={{ position: "relative", width: 380, height: 88 }}>
      {dots.map((d, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${d.leftPct}%`,
            top: `${d.topPct}%`,
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--cream)",
            opacity: 0.7,
            animation: `r-mesh-blink 2.8s ease-in-out ${d.delay}ms infinite`,
          }}
        />
      ))}
    </div>
  );
}

function StaticArrivalFrame({ onPlay }: { onPlay: () => void }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <EngineerCard active={true} />
        <button type="button" onClick={onPlay} style={PLAY_OVERLAY_BTN}>
          <PlayIcon /> Play 60-second explainer with audio
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type wrappers
// ---------------------------------------------------------------------------

function Eyebrow({ children, italic }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <span style={{
      fontFamily: "var(--font-display)",
      fontStyle: italic ? "italic" : "normal",
      fontSize: 16,
      color: "rgba(244,242,238,0.78)",
      maxWidth: 520,
      textAlign: "center",
      lineHeight: 1.4,
    }}>
      {children}
    </span>
  );
}

function Mono({ children, fade }: { children: React.ReactNode; fade?: boolean }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: fade ? "rgba(244,242,238,0.45)" : "rgba(244,242,238,0.7)",
    }}>
      {children}
    </span>
  );
}

function Display({
  children, italic, deep,
}: { children: React.ReactNode; italic?: boolean; deep?: boolean }) {
  return (
    <span style={{
      fontFamily: "var(--font-display)",
      fontStyle: italic ? "italic" : "normal",
      fontSize: 32,
      letterSpacing: "-0.018em",
      color: deep ? "var(--green-deep)" : "var(--cream)",
      lineHeight: 1.1,
    }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3 2l11 6-11 6V2z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2" width="3.5" height="12" />
      <rect x="9.5" y="2" width="3.5" height="12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const LAPTOP_OUTER: React.CSSProperties = {
  width: "min(60%, 480px)",
  borderRadius: 8,
  background: "rgba(20,20,19,0.85)",
  border: "1px solid rgba(244,242,238,0.1)",
  overflow: "hidden",
  boxShadow: "0 24px 60px -30px rgba(0,0,0,0.6)",
};

const LAPTOP_BAR: React.CSSProperties = {
  height: 22, display: "flex", alignItems: "center", gap: 6,
  padding: "0 12px", borderBottom: "1px solid rgba(244,242,238,0.06)",
};

const LAPTOP_DOT: React.CSSProperties = {
  width: 8, height: 8, borderRadius: "50%", background: "#c4604c",
  display: "inline-block",
};

const LAPTOP_BODY: React.CSSProperties = {
  padding: "20px 18px",
  fontFamily: "var(--font-mono)",
  minHeight: 140,
};

const CONTROLS_ROW: React.CSSProperties = {
  position: "absolute", left: 18, right: 18, bottom: 14,
  display: "flex", alignItems: "center", gap: 12,
  pointerEvents: "auto",
};

const CONTROL_BTN: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%",
  border: "1px solid rgba(244,242,238,0.2)",
  background: "rgba(20,20,19,0.6)",
  color: "var(--cream)",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};

const PROGRESS_TRACK: React.CSSProperties = {
  flex: 1, height: 2, background: "rgba(244,242,238,0.15)", borderRadius: 1,
  overflow: "hidden",
};

const PROGRESS_FILL: React.CSSProperties = {
  height: "100%", background: "var(--green)",
  transformOrigin: "left center", transform: "scaleX(0)",
  transition: "transform 120ms linear",
};

const TIMECODE: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: "rgba(244,242,238,0.55)", letterSpacing: "0.06em",
  minWidth: 64, textAlign: "right",
};

const CAPTION_TRACK: React.CSSProperties = {
  position: "absolute", left: 0, right: 0, bottom: 48,
  display: "flex", justifyContent: "center", padding: "0 24px",
  pointerEvents: "none",
};

const CAPTION_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: 13,
  color: "var(--cream)", background: "rgba(20,20,19,0.55)",
  padding: "4px 10px", borderRadius: 4,
  maxWidth: "80%", textAlign: "center",
};

const PLAY_OVERLAY: React.CSSProperties = {
  position: "absolute", inset: 0,
  background: "rgba(20,20,19,0.35)",
  border: "none",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const PLAY_OVERLAY_INNER: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
  color: "var(--cream)",
};

const PLAY_OVERLAY_BTN: React.CSSProperties = {
  marginTop: 12, padding: "10px 18px",
  background: "rgba(244,242,238,0.08)",
  border: "1px solid rgba(244,242,238,0.18)",
  color: "var(--cream)",
  fontFamily: "var(--font-sans)", fontSize: 13,
  borderRadius: 6, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 10,
};
