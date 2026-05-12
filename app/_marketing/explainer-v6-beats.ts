/*
 * Single source of truth for the v6 explainer beat structure.
 *
 * Both the build script (`build-explainer-v6.ts`) and the React motion-graphic
 * component (`ExplainerMotionV6.tsx`) import from here so the audio file, the
 * on-screen animation triggers, and the cinematic shot list stay frame-aligned.
 */

export type Beat = {
  id: string;
  /** Beat start time in seconds, relative to the explainer's 0:00 start. */
  start: number;
  /** Beat end time in seconds (exclusive). */
  end: number;
  /** VO line read during this beat (or null for silent transition beats). */
  vo: string | null;
  /** Display caption for the build log only. Not shown on screen. */
  label: string;
};

export const BEATS: Beat[] = [
  {
    id: "1-build",
    start: 0,
    end: 6,
    vo: "You're building with AI. It works. Most of the way.",
    label: "The build moment",
  },
  {
    id: "2-wall",
    start: 6,
    end: 13,
    vo: "And then the AI runs out, and you wish a real engineer was in the room.",
    label: "The wall",
  },
  {
    id: "3-press",
    start: 13,
    end: 19,
    vo: "That's the press. One button. Inside the tool you're already using.",
    label: "The press",
  },
  {
    id: "4-arrival",
    start: 19,
    end: 27,
    vo: "A software engineer joins your build. By name. By face. Through the same Zoom your team already uses.",
    label: "The arrival",
  },
  {
    id: "5-modalities",
    start: 27,
    end: 33,
    vo: "Chat, voice, or screen share. You pick. Tied to your project, recorded with consent.",
    label: "Three modalities",
  },
  {
    id: "6a-phase1",
    start: 33,
    end: 38,
    vo: "Phase one. You build. Your engineer supports.",
    label: "Phase 01 - Build",
  },
  {
    id: "6b-phase2",
    start: 38,
    end: 43,
    vo: "Phase two. Launch and go live. Your engineer leads.",
    label: "Phase 02 - Launch & Go-Live",
  },
  {
    id: "6c-phase3",
    start: 43,
    end: 49,
    vo: "Phase three. Maintain and scale. Your engineer takes accountability.",
    label: "Phase 03 - Maintain & Scale",
  },
  {
    id: "6d-relay",
    start: 49,
    end: 51,
    vo: "Same engineer. End to end.",
    label: "The relay payoff",
  },
  {
    id: "7-trust",
    start: 51,
    end: 56,
    vo: "Engineers in fifteen plus countries. Compliance built in.",
    label: "Trust posture",
  },
  {
    id: "8-close",
    start: 56,
    end: 60,
    vo: "Build with AI. Ship with engineers. Relay.",
    label: "End card",
  },
];

export const TOTAL_DURATION = 60;

export const VOICE_CONFIG = {
  voice: "en-US-AndrewMultilingualNeural",
  rate: "-12%",
  pitch: "-2Hz",
} as const;
