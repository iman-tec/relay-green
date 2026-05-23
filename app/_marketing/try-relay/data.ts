/*
 * Static data + pure helpers for the Try Relay wizard.
 *
 * Three question option arrays, three engineer profiles, and a single
 * pickEngineer() pure function. No React, no DOM — everything here is
 * trivially testable and trivially swappable for a real backend call
 * when the bench-matching API is ready.
 */

export type Need = "building" | "launching" | "ongoing";
export type Timeline = "now" | "this-week" | "planning";

export type NeedOption = {
  id: Need;
  icon: string;
  title: string;
  body: string;
};

export type TimelineOption = {
  id: Timeline;
  icon?: string;
  pulse?: boolean;
  title: string;
  body: string;
};

export type Engineer = {
  id: string;
  name: string;
  initials: string;
  title: string;
  years: number;
  skills: string[];
  availability: string;
};

/* ---------- Q1: What do you need right now? ---------- */
export const NEEDS: NeedOption[] = [
  {
    id: "building",
    icon: "🟥",
    title: "I’m building — need help getting unstuck",
    body: "You’re in the middle of a build with AI. Hit a wall. Need a human to debug, architect, or just point you the right way.",
  },
  {
    id: "launching",
    icon: "🚀",
    title: "I’m ready to launch — need someone to ship it",
    body: "Your MVP works. Now you need domains, SSL, security, performance, and a production deploy. Someone who’s done it before.",
  },
  {
    id: "ongoing",
    icon: "🔧",
    title: "I need ongoing support — maintenance, scale, reliability",
    body: "Your product is live. APIs change, dependencies break, traffic grows. You need someone who remembers your stack.",
  },
];

/* ---------- Q2: What are you building with? ---------- */
export const STACK_GROUPS: {
  label: string;
  id: "aiTool" | "backend" | "frontend";
  options: string[];
  multi: boolean;
}[] = [
  {
    label: "AI tool you use",
    id: "aiTool",
    multi: false,
    options: [
      "Claude",
      "ChatGPT",
      "Cursor",
      "Copilot",
      "Gemini",
      "Lovable",
      "Replit",
      "Other",
    ],
  },
  {
    label: "Backend & infrastructure",
    id: "backend",
    multi: true,
    options: [
      "AWS",
      "Vercel",
      "GCP",
      "Cloudflare",
      "Node.js",
      "Python",
      "Postgres",
      "Supabase",
      "Other",
    ],
  },
  {
    label: "Frontend & tools",
    id: "frontend",
    multi: true,
    options: ["React", "Next.js", "Vue", "Tailwind", "Figma", "Other"],
  },
];

/* ---------- Q3: How soon? ---------- */
export const TIMELINES: TimelineOption[] = [
  {
    id: "now",
    pulse: true,
    title: "Right now — I’m stuck",
    body: "An engineer joins your session in under 30 seconds. First 10 minutes free.",
  },
  {
    id: "this-week",
    icon: "📅",
    title: "This week",
    body: "Schedule a session. We’ll match you with someone who has relevant context and is ready when you are.",
  },
  {
    id: "planning",
    icon: "📘",
    title: "I’m planning ahead",
    body: "Let’s scope it. You tell us what you’re building, we quote on complexity. No commitment.",
  },
];

/* ---------- Engineer profiles ---------- */
export const ENGINEERS: Engineer[] = [
  {
    id: "jordan",
    name: "Jordan D.",
    initials: "JD",
    title: "Full-stack lead",
    years: 6,
    skills: ["Next.js", "Supabase", "Stripe"],
    availability: "Available now · ~20s to join",
  },
  {
    id: "priya",
    name: "Priya R.",
    initials: "PR",
    title: "Backend engineer",
    years: 8,
    skills: ["Postgres", "AWS", "Node.js"],
    availability: "Available now · ~25s to join",
  },
  {
    id: "marcus",
    name: "Marcus K.",
    initials: "MK",
    title: "Production engineer",
    years: 10,
    skills: ["Cloudflare", "Python", "Vercel"],
    availability: "Available now · ~30s to join",
  },
];

/* ---------- Match logic (v1, deterministic) ----------
 * Rules in priority order. Returns null only if state has no usable
 * signal — in practice we always have at least one AI tool selected
 * by the time the user reaches the match step. The fallback bucket
 * (Marcus) catches any future state we forgot to handle.
 */
export type WizardSnapshot = {
  need: Need | null;
  aiTool: string | null;
  backend: string[];
  frontend: string[];
  timeline: Timeline | null;
};

export function pickEngineer(state: WizardSnapshot): Engineer {
  const ai = state.aiTool ?? "";
  const back = state.backend;

  // Full-stack builders (Cursor / Lovable / Replit / v0 users)
  // tend to need someone who can move across the whole stack.
  if (["Cursor", "Lovable", "Replit", "v0"].includes(ai)) {
    return ENGINEERS[0]; // Jordan
  }

  // Backend-heavy selection picks up Priya.
  if (
    back.includes("AWS") ||
    back.includes("Postgres") ||
    back.includes("Node.js") ||
    back.includes("Python")
  ) {
    return ENGINEERS[1]; // Priya
  }

  // Default: production engineer for everything else
  // (launching / ongoing / non-coder AI tool reviewers).
  return ENGINEERS[2]; // Marcus
}

/* The primary stack chip we surface on the loading-screen subtext.
 * Falls back gracefully if the user skipped the stack step entirely
 * (shouldn't be possible per the UI gates, but defensive). */
export function primaryStackLabel(state: WizardSnapshot): string {
  if (state.aiTool && state.aiTool !== "Other") return state.aiTool;
  if (state.backend[0]) return state.backend[0];
  if (state.frontend[0]) return state.frontend[0];
  return "your stack";
}
