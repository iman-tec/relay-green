/*
 * Intake-assistant stub.
 *
 * The customer hits "Get an engineer now" → we ring engineers → the customer
 * sits in the ringing surface for ~90 seconds. Brief §5.4 + §7 spec: don't
 * leave them staring at a dead modal. Pre-load context for the engineer
 * via a scripted assistant that asks a structured intake one question at
 * a time, then renders an at-a-glance "Context for your engineer" card.
 *
 * THIS FILE IS PURE / STUBBED. No fetch, no model, no key. Local React
 * state in the UI shell is all the persistence we have. The interface
 * below is the seam: backend (Anthropic) can swap the implementation
 * without the UI changing.
 *
 * Same module is reused for the in-call assistant in §5.5 (when the
 * customer is on Zoom and the dead space would otherwise feel empty).
 */

export type IntakeRole = "assistant" | "user";

export interface IntakeMessage {
  id: string;
  role: IntakeRole;
  body: string;
  /** Optional screenshot/attachment thumbnail (data URL or object URL). */
  attachment?: {
    name: string;
    previewUrl: string;
    /** "image/png", "text/plain", etc. */
    mime: string;
  };
  createdAt: number;
}

/** Final structured handoff to the engineer. Lives only in client state
 *  for now; will be persisted via the seam below when wired. */
export interface IntakeContext {
  building?: string;
  problem?: string;
  stack?: string;
  aiTools?: string;
  attachments: IntakeMessage["attachment"][];
}

/** Text-bearing fields the assistant can capture from a user answer. */
export type IntakeTextField = "building" | "problem" | "stack" | "aiTools";

/** A single prompt the assistant will speak. */
export interface IntakePrompt {
  /** Stable id so the UI can dedupe and re-render reliably. */
  id: IntakeTextField | "wrap_up";
  /** Body of the assistant message. */
  body: string;
  /** Optional placeholder shown in the user composer. */
  composerHint?: string;
  /** If set, the user's answer is captured as the named context field. */
  fieldFromAnswer: IntakeTextField | null;
  /**
   * Optional quick-reply chips shown under the prompt. Clicking a chip
   * submits it as the user's answer (single-tap). UI-level affordance —
   * doesn't change the captured-answer shape (just plain text). */
  quickReplies?: string[];
}

/**
 * The script. Tunable in one place. When the real model takes over, the
 * "next-prompt" function is replaced — call-sites do not change.
 */
export const INTAKE_SCRIPT: ReadonlyArray<IntakePrompt> = [
  {
    id: "building",
    body: "While we line up an engineer — tell me what you're building. A sentence or two is plenty: the kind of product, who it's for, and how far along you are.",
    composerHint: "e.g. a CRM dashboard for our sales team…",
    fieldFromAnswer: "building",
  },
  {
    id: "problem",
    body: "What's going wrong, or what's the next step you can't quite get past? Paste the exact error or a screenshot if you have one — the more context I have, the faster your engineer can dive in.",
    composerHint: "Describe the error or what's blocked…",
    fieldFromAnswer: "problem",
  },
  {
    id: "stack",
    body: "Which stack is involved? Frameworks, services, anything you've tried so far. (e.g. Next.js + Supabase on Vercel, Python + Postgres, Lovable + Cloudflare.)",
    composerHint: "Languages, frameworks, services…",
    fieldFromAnswer: "stack",
  },
  {
    id: "aiTools",
    body: "Which AI tools have you been pairing with on this build? It helps me match you with someone who's shipped on the same toolchain.",
    composerHint: "Comma-separated is fine…",
    fieldFromAnswer: "aiTools",
    quickReplies: ["Claude", "ChatGPT", "Cursor", "Replit", "Lovable", "Bolt"],
  },
  {
    id: "wrap_up",
    body: "Thanks — your engineer will see all of this the moment they join. Feel free to keep adding context or drop a screenshot any time; nothing here goes to waste.",
    fieldFromAnswer: null,
  },
];

/** Resolve which prompt to ask next given the running context. Returns null
 *  when the script is exhausted (assistant goes quiet, customer keeps typing). */
export function askNext(ctx: IntakeContext): IntakePrompt | null {
  for (const p of INTAKE_SCRIPT) {
    if (p.id === "wrap_up") {
      // Only emit wrap-up once all the field-bearing prompts are answered.
      const allFilled = INTAKE_SCRIPT.every(
        (q) => !q.fieldFromAnswer || Boolean(ctx[q.fieldFromAnswer])
      );
      return allFilled ? p : null;
    }
    if (p.fieldFromAnswer && !ctx[p.fieldFromAnswer]) {
      return p;
    }
  }
  return null;
}

/** Merge a user answer into the running context per the prompt's field. */
export function captureAnswer(
  ctx: IntakeContext,
  prompt: IntakePrompt,
  answer: string,
  attachment?: IntakeMessage["attachment"]
): IntakeContext {
  const next: IntakeContext = {
    ...ctx,
    attachments: attachment
      ? [...ctx.attachments, attachment]
      : ctx.attachments,
  };
  if (prompt.fieldFromAnswer && answer.trim()) {
    next[prompt.fieldFromAnswer] = answer.trim();
  }
  return next;
}

/** Empty context factory. */
export function emptyContext(): IntakeContext {
  return { attachments: [] };
}

/** Whether the context has at least one usable field for the engineer. */
export function contextIsUseful(ctx: IntakeContext): boolean {
  return Boolean(ctx.building || ctx.problem || ctx.stack || ctx.aiTools);
}

// TODO(api): replace this whole module with a real assistant transport
// (Anthropic Claude). Keep `askNext` + `captureAnswer` + `IntakeContext`
// signatures stable so the UI does not change when wired.
//
// Suggested wire-up:
//
//   import Anthropic from "@anthropic-ai/sdk";
//   export async function askNext(ctx: IntakeContext): Promise<IntakePrompt | null> {
//     const r = await anthropic.messages.create({ model, ... });
//     return { id: …, body: r.content[0].text, fieldFromAnswer: …, … };
//   }
//
// The current pure implementation lets the UI shell be built and tested
// without API keys; flipping to the real one is a one-file change.
