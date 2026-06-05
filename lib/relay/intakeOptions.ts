/*
 * Canonical intake options — shared between the customer-side connect
 * flow (RoomClient `DetailsStep`) and the engineer-side onboarding
 * wizard. Both sides must pick from the same lists so the matcher can
 * score engineer capabilities against customer needs along the same
 * dimensions.
 *
 * Customer picks ONE per axis; engineer picks MULTIPLE per axis (capabilities).
 *
 * Source of truth for these arrays is THIS file. RoomClient currently
 * has its own copies (see NEW_PROJECT_TYPES / NEW_PROJECT_AI_TOOLS /
 * NEW_PROJECT_BACKENDS / NEW_PROJECT_FRONTENDS) — those should be
 * refactored to import from here in a follow-up that touches /room.
 */

export type ProjectTypeOption = {
  /** Stored value — matches customer intake choices verbatim. */
  value: string;
  /** Small emoji surfaced in the picker UI for quick visual scanning. */
  emoji: string;
};

/** Project-type options. Persona-driven (dashboards, CRMs, e-commerce,
 *  etc.) so customers pick what they're building in their own language.
 *  An "Other" escape hatch covers anything not enumerated.
 *
 *  Matches the customer-side NEW_PROJECT_TYPES in RoomClient exactly. */
export const PROJECT_TYPE_OPTIONS: ReadonlyArray<ProjectTypeOption> = [
  { value: "Internal dashboard / KPI tracker", emoji: "📊" },
  { value: "Marketing landing page", emoji: "🌐" },
  { value: "Customer portal / Web app", emoji: "💻" },
  { value: "Lead capture / Form tool", emoji: "📋" },
  { value: "Internal workflow / Automation", emoji: "⚙️" },
  { value: "Knowledge base / Wiki", emoji: "📚" },
  { value: "AI chatbot / Assistant", emoji: "🤖" },
  { value: "Reporting / Analytics tool", emoji: "📈" },
  { value: "CRM / Customer tracker", emoji: "👥" },
  { value: "Booking / Scheduling app", emoji: "📅" },
  { value: "Training / Course platform", emoji: "🎓" },
  { value: "E-commerce storefront", emoji: "🛒" },
  { value: "Mobile app", emoji: "📱" },
  { value: "Other", emoji: "✨" },
] as const;

/** AI tools the customer might be building with — matches the homepage
 *  "AI tools we support" pill row + lib/relay/profile STACK_OPTIONS. */
export const AI_TOOL_OPTIONS: ReadonlyArray<string> = [
  "Claude",
  "ChatGPT",
  "Cursor",
  "Lovable",
  "v0",
  "Replit",
  "Bolt",
  "Windsurf",
  "Other",
] as const;

/** Backend / infrastructure stacks. */
export const BACKEND_STACK_OPTIONS: ReadonlyArray<string> = [
  "Supabase",
  "Firebase",
  "Vercel",
  "AWS",
  "Postgres",
  "MongoDB",
  "Node.js",
  "Python",
  "Not sure",
] as const;

/** Frontend / UI stacks. */
export const FRONTEND_STACK_OPTIONS: ReadonlyArray<string> = [
  "React",
  "Next.js",
  "Vue",
  "Plain HTML/CSS",
  "Tailwind",
  "React Native",
  "Flutter",
  "Not sure",
] as const;

/** Just the value strings, without the emoji metadata. Convenient for
 *  multi-select chip groups that don't need the icons. */
export const PROJECT_TYPE_VALUES: ReadonlyArray<string> =
  PROJECT_TYPE_OPTIONS.map((o) => o.value);
