/*
 * Customer-profile shared contract (master-prompt §5).
 *
 * Single source of truth for the editable profile surface:
 *   - the professional-background ("field of interest") option set
 *   - avatar upload limits + accepted types
 *   - the read-only technical-expertise label, mapped from the durable
 *     Q1 intake answer so the wording stays consistent app-wide
 *
 * Persistence lives in the `customer_profiles` table + `avatars` storage
 * bucket (see supabase/migrations/20260522130000_customer_profiles.sql).
 * localStorage (lib/relay/profile.ts) remains the offline / pre-auth cache.
 */

import { TECH_COMFORT_OPTIONS, type TechComfort } from "./profile";

/** Predefined professional-background pills. "Other" reveals a free-text box. */
export const FIELD_OF_INTEREST_OPTIONS = [
  "Finance",
  "Marketing",
  "Sales",
  "HR",
  "Business",
  "Manufacturing",
  "Retail",
  "Other",
] as const;

export type FieldOfInterest = (typeof FIELD_OF_INTEREST_OPTIONS)[number];

/** Avatar upload limits — mirrored by the `avatars` bucket file_size_limit. */
export const AVATAR_MAX_BYTES = 2_097_152; // 2 MB
export const AVATAR_ACCEPTED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const AVATAR_INPUT_ACCEPT = "image/jpeg,image/png,image/webp";

/** Shape of a `customer_profiles` row as read/written from the browser. */
export interface CustomerProfileRow {
  user_id: string;
  display_name: string | null;
  technical_expertise: TechComfort | null;
  fields_of_interest: string[];
  interest_other: string | null;
  avatar_url: string | null;
  /** Email opt-in. Defaults TRUE at signup (covered by ToS) — flipping
   *  FALSE suppresses all transactional + marketing email for this user.
   *  Migration 20260526120000_customer_notification_prefs added the column. */
  email_notifications_enabled?: boolean;
  email_notifications_updated_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * The intake table stores Q1 as `familiarity` with a different vocabulary
 * than the wizard's TechComfort enum. Map it back so we can seed a profile's
 * read-only expertise field from the customer's most recent intake.
 */
export function techComfortFromFamiliarity(
  familiarity: string | null | undefined
): TechComfort | null {
  switch (familiarity) {
    case "Well Experienced":
      return "well_experienced";
    case "Semi-Technical":
      return "semi_technical";
    case "Totally Unknown":
      return "non_technical";
    default:
      return null;
  }
}

/** Human-readable label for the read-only expertise field. */
export function techComfortLabel(value: TechComfort | null): string {
  if (!value) return "Not set yet";
  return (
    TECH_COMFORT_OPTIONS.find((o) => o.value === value)?.label ?? "Not set yet"
  );
}

/** Client-side avatar validation — fast feedback before upload. */
export function validateAvatar(
  file: File
): { ok: true } | { ok: false; error: string } {
  if (!AVATAR_ACCEPTED_MIME.has(file.type)) {
    return { ok: false, error: "Please choose a JPG, PNG, or WebP image." };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: "Image must be 2 MB or smaller." };
  }
  return { ok: true };
}
