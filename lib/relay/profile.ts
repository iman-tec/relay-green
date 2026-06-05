/*
 * Profile-context store — local stub.
 *
 * The intake wizard collects durable signals on a customer's first session:
 *   - techComfort: how to right-size the engineer's communication
 *   - stack: which AI tools / backend / frontend they actually use
 *   - urgency: whether they need someone now / this week / later
 *
 * Those are PROFILE data, not one-off intake data. Returning users must not
 * be re-asked. This module owns:
 *
 *   - readProfile()       : snapshot of the stored fields
 *   - patchProfile(p)     : merge an update (deep-ish — stack arrays are
 *                           merged dedup-style, scalars overwrite)
 *   - hasFullIntake()     : true when techComfort + at least one stack
 *                           bucket is filled
 *
 * Storage: `localStorage` keyed `relay-profile-v1`. SSR-safe (no-ops on
 * server, in-memory on first paint, hydrate on mount).
 *
 * // TODO(profile): wire to a real backend store. Suggested shape:
 *   - column `customer_user_id uuid` + `profile jsonb` on a new
 *     `customer_profiles` table, or extend `customer_summaries`.
 *   - on submit, upsert via RPC `upsert_customer_profile(_payload jsonb)`.
 *   - on read, the browser client hydrates once on /room or /intake mount.
 *   - keep the localStorage path as a fallback for offline / pre-auth.
 */

export type TechComfort =
  | "non_technical" // "I'm building with AI tools and need things explained simply."
  | "semi_technical" // "I can follow along and make edits, but I get stuck."
  | "well_experienced"; // "I code; I just need an expert pair on this."

export type Urgency = "now" | "this_week" | "planning";

export type Need = "stuck" | "launch" | "maintain";

export interface ProfileStack {
  aiTools: string[];
  backend: string[];
  frontend: string[];
}

export interface ProfileSnapshot {
  techComfort: TechComfort | null;
  stack: ProfileStack;
  urgency: Urgency | null;
  /** Last project the customer started a session in (drives the
   *  returning-user "Is this for [Project Name]?" default). */
  lastProjectId: string | null;
  lastProjectName: string | null;
  /** Set true once the customer has completed the full intake at least
   *  once. Returning users skip the heavy intake and see the lightweight
   *  project-confirm screen instead. */
  hasFullIntake: boolean;
  /** Supabase auth user id this profile belongs to. Binding the local
   *  cache to a specific user prevents the "shared browser → wrong user
   *  sees Welcome back" bug: when the current auth user does not match,
   *  callers must treat the profile as empty. */
  userId: string | null;
  /** Epoch ms of last persist. Used in debug + future expiry. */
  updatedAt: number;
}

const STORAGE_KEY = "relay-profile-v1";

function empty(): ProfileSnapshot {
  return {
    techComfort: null,
    stack: { aiTools: [], backend: [], frontend: [] },
    urgency: null,
    lastProjectId: null,
    lastProjectName: null,
    hasFullIntake: false,
    userId: null,
    updatedAt: 0,
  };
}

function safeParse(raw: string | null): ProfileSnapshot {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileSnapshot>;
    return {
      ...empty(),
      ...parsed,
      stack: {
        aiTools: parsed.stack?.aiTools ?? [],
        backend: parsed.stack?.backend ?? [],
        frontend: parsed.stack?.frontend ?? [],
      },
    };
  } catch {
    return empty();
  }
}

export function readProfile(): ProfileSnapshot {
  if (typeof window === "undefined") return empty();
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export interface ProfilePatch {
  techComfort?: TechComfort | null;
  urgency?: Urgency | null;
  /** Merge — incoming entries are appended dedup-style to the existing
   *  bucket. Pass an empty array to clear via writeProfile() instead. */
  stack?: Partial<ProfileStack>;
  lastProjectId?: string | null;
  lastProjectName?: string | null;
  hasFullIntake?: boolean;
  userId?: string | null;
}

function mergeStack(
  prev: ProfileStack,
  incoming?: Partial<ProfileStack>
): ProfileStack {
  if (!incoming) return prev;
  const dedupAppend = (a: string[], b?: string[]) => {
    if (!b) return a;
    const set = new Set(a.map((x) => x.toLowerCase()));
    const out = [...a];
    for (const item of b) {
      const k = item.trim();
      if (!k) continue;
      if (set.has(k.toLowerCase())) continue;
      out.push(k);
      set.add(k.toLowerCase());
    }
    return out;
  };
  return {
    aiTools: dedupAppend(prev.aiTools, incoming.aiTools),
    backend: dedupAppend(prev.backend, incoming.backend),
    frontend: dedupAppend(prev.frontend, incoming.frontend),
  };
}

export function patchProfile(p: ProfilePatch): ProfileSnapshot {
  const prev = readProfile();
  const next: ProfileSnapshot = {
    ...prev,
    techComfort: p.techComfort === undefined ? prev.techComfort : p.techComfort,
    urgency: p.urgency === undefined ? prev.urgency : p.urgency,
    stack: mergeStack(prev.stack, p.stack),
    lastProjectId:
      p.lastProjectId === undefined ? prev.lastProjectId : p.lastProjectId,
    lastProjectName:
      p.lastProjectName === undefined
        ? prev.lastProjectName
        : p.lastProjectName,
    hasFullIntake:
      p.hasFullIntake === undefined ? prev.hasFullIntake : p.hasFullIntake,
    userId: p.userId === undefined ? prev.userId : p.userId,
    updatedAt: Date.now(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / privacy mode — local-only, swallow */
    }
  }
  return next;
}

/** Overwrite the entire stack bucket (used by the "clear" flow). */
export function writeStack(stack: ProfileStack): ProfileSnapshot {
  const prev = readProfile();
  const next: ProfileSnapshot = {
    ...prev,
    stack,
    updatedAt: Date.now(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* swallow */
    }
  }
  return next;
}

/** Convenience: does this profile have enough to skip the full intake?
 *  When `currentUserId` is supplied, returns false on a userId mismatch —
 *  protects against the shared-browser cross-account contamination bug
 *  where a stale localStorage profile leaked a "Welcome back" greeting
 *  onto a new sign-in. Pass `null` to skip the binding check (guest path).
 */
export function hasFullIntake(
  p: ProfileSnapshot = readProfile(),
  currentUserId?: string | null
): boolean {
  if (!p.hasFullIntake) return false;
  if (!p.techComfort) return false;
  if (currentUserId !== undefined && p.userId && p.userId !== currentUserId) {
    return false;
  }
  const total =
    p.stack.aiTools.length + p.stack.backend.length + p.stack.frontend.length;
  return total > 0;
}

/** Wipe the local profile entirely. Called when the auth user changes and
 *  the prior cached profile belonged to a different account. */
export function clearProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow */
  }
}

/** Human-readable stack list ("Claude, Next.js, Supabase") for the
 *  in-chat increment prompt. Pulls from all three buckets in priority order. */
export function flattenStack(p: ProfileStack): string[] {
  return [...p.aiTools, ...p.backend, ...p.frontend];
}

export const TECH_COMFORT_OPTIONS: ReadonlyArray<{
  value: TechComfort;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    value: "non_technical",
    label: "Non-technical",
    description: "I'm building with AI tools and need things explained simply.",
    emoji: "🧑",
  },
  {
    value: "semi_technical",
    label: "Semi-technical",
    description: "I can follow along and make edits, but I get stuck.",
    emoji: "🛠️",
  },
  {
    value: "well_experienced",
    label: "Technically equipped",
    description: "I code; I just need an expert pair on this.",
    emoji: "💻",
  },
];

export const NEED_OPTIONS: ReadonlyArray<{
  value: Need;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    value: "stuck",
    label: "I'm building — need help getting unstuck",
    description:
      "You're in the middle of a build with AI. Hit a wall. Need a human to debug, architect, or just point you the right way.",
    emoji: "🟥",
  },
  {
    value: "launch",
    label: "I'm ready to launch — need someone to ship it",
    description:
      "Your MVP works. Now you need domains, SSL, security, performance, and a production deploy. Someone who's done it before.",
    emoji: "🚀",
  },
  {
    value: "maintain",
    label: "I need ongoing support — maintenance, scale, reliability",
    description:
      "Your product is live. APIs change, dependencies break, traffic grows. You need someone who remembers your stack.",
    emoji: "🔧",
  },
];

export const URGENCY_OPTIONS: ReadonlyArray<{
  value: Urgency;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    value: "now",
    label: "Right now — I'm stuck",
    description:
      "An engineer joins in under 30 seconds. First 10 minutes free.",
    emoji: "🟢",
  },
  {
    value: "this_week",
    label: "This week",
    description: "Schedule a session, matched with relevant context.",
    emoji: "🗓️",
  },
  {
    value: "planning",
    label: "I'm planning ahead",
    description: "Scope it, quote on complexity. No commitment.",
    emoji: "💡",
  },
];

export const STACK_OPTIONS: {
  category: "aiTools" | "backend" | "frontend";
  label: string;
  options: string[];
}[] = [
  {
    category: "aiTools",
    label: "AI tool you use",
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
    category: "backend",
    label: "Backend & infrastructure",
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
    category: "frontend",
    label: "Frontend & tools",
    options: ["React", "Next.js", "Vue", "Tailwind", "Figma", "Other"],
  },
];
