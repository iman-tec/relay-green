/*
 * Centralized invitation-email plumbing.
 *
 * Flow:
 *   1. Generate a one-time temp password.
 *   2. inviteUserByEmail with user_metadata.temp_password set — Supabase
 *      sends the email using our invite template, which renders the
 *      temp password prominently (no magic-link button).
 *   3. Immediately admin.updateUserById to confirm the email and set the
 *      auth password to the temp value. By the time the email is read,
 *      the user can sign in with email + temp password.
 *   4. On their first /api/auth/signin-password, app_metadata.password_set
 *      is missing → they're diverted to /set-password to pick their own.
 *
 * Why the temp-password approach over Supabase's magic-link verifyOtp:
 * we hit too many template / redirect / hash-fragment fiddly bits with
 * that route. A plain temp password works the same on every Supabase
 * config and is observable end-to-end.
 *
 * Re-invite policy:
 *   • Brand new user                  → create + send.
 *   • Existing user, no password_set  → reset temp password + re-send.
 *   • Existing user, password_set     → return "already_active". The
 *                                       caller decides whether that's an
 *                                       error or a silent attach.
 */

import { randomBytes } from "node:crypto";
import { createClient as createAnonClient, type SupabaseClient } from "@supabase/supabase-js";

export type InvitePayload = {
  /** Recipient — lowercased + trimmed inside. */
  email:        string;
  /** Display name written to user_metadata. Optional. */
  displayName?: string;
  /** Free-form metadata merged into user_metadata (org_id, role_label, …). */
  metadata?:    Record<string, unknown>;
  /**
   * Invite-only mode (bugs2.txt #1). When true, existing-active users
   * (password_set === true) return mode: "already_active" without
   * mailing them anything, so the caller can silently attach them
   * (e.g. to a pod) without an extra email.
   *
   * Default (false) keeps the legacy behaviour for places like
   * "resend-invite" — but with the new temp-password flow, existing
   * confirmed users still return already_active rather than getting
   * their chosen password reset.
   */
  inviteOnly?:  boolean;
};

export type InviteResult =
  | { ok: true;  mode: "invited" | "reset" | "already_active"; userId?: string; tempPassword?: string }
  | { ok: false; error: string };

/**
 * Generate a temp password — 12 chars, mixed case + digits, no
 * lookalikes (no 0/O, 1/l/I). Good enough as a one-time credential.
 */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function findExistingUser(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; passwordSet: boolean } | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = data?.users?.find((x) => x.email?.toLowerCase() === email);
  if (!u) return null;
  const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
  return { id: u.id, passwordSet: meta.password_set === true };
}

/**
 * Send an invitation email with a one-time temp password.
 *
 * @param admin   service-role Supabase client
 * @param payload caller-provided email + metadata
 */
export async function sendInvitationEmail(
  admin: SupabaseClient,
  payload: InvitePayload,
): Promise<InviteResult> {
  const email = payload.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  const existing = await findExistingUser(admin, email);

  // Existing user who has already chosen their own password — don't
  // overwrite it. The caller can silently attach them to whatever they
  // were inviting them to.
  if (existing?.passwordSet) {
    return { ok: true, mode: "already_active", userId: existing.id };
  }

  const tempPassword = generateTempPassword();
  const userMeta: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    ...(payload.displayName ? { display_name: payload.displayName } : {}),
    temp_password: tempPassword,
  };

  // Brand-new user — invite (sends email) then immediately confirm +
  // set the temp password. By the time the email is delivered the user
  // can sign in normally.
  if (!existing) {
    const invite = await admin.auth.admin.inviteUserByEmail(email, { data: userMeta });
    if (invite.error || !invite.data?.user) {
      return { ok: false, error: explainSmtp(invite.error?.message ?? "Invite failed.") };
    }
    const userId = invite.data.user.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password:      tempPassword,
      email_confirm: true,
      app_metadata:  { password_set: false },
    });
    if (updErr) {
      return { ok: false, error: updErr.message };
    }
    return { ok: true, mode: "invited", userId, tempPassword };
  }

  // Existing user who never finished setup — reset their temp password
  // and re-send the email via signInWithOtp (the only call that mails
  // confirmed users).
  const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
    password:      tempPassword,
    email_confirm: true,
    user_metadata: userMeta,
    app_metadata:  { password_set: false },
  });
  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  if (payload.inviteOnly) {
    // Caller doesn't want a second email — just return so they can
    // proceed with whatever attach they were doing.
    return { ok: true, mode: "reset", userId: existing.id, tempPassword };
  }

  // Trigger an email by calling inviteUserByEmail again — it'll error
  // because the user exists, but we ignore the error and fall back to
  // signInWithOtp through an anon client which mails confirmed users.
  // The template will render with the temp_password we just stored on
  // user_metadata.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, error: "Supabase env not configured for re-invite email." };
  }
  const anon = createAnonClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpErr } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (otpErr) {
    return { ok: false, error: explainSmtp(otpErr.message) };
  }
  return { ok: true, mode: "reset", userId: existing.id, tempPassword };
}

/**
 * Resend an invitation to an existing user. Generates a fresh temp
 * password (overwriting any previous one) for any user who hasn't yet
 * picked their own.
 */
export async function resendInvitationEmail(
  admin: SupabaseClient,
  userId: string,
): Promise<InviteResult> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    return { ok: false, error: error?.message ?? "User not found." };
  }
  return sendInvitationEmail(admin, { email: data.user.email });
}

/** Friendlier error message when SMTP isn't configured / rate-limited. */
function explainSmtp(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Supabase email rate limit hit. Wait a minute or configure a custom SMTP provider.";
  }
  if (m.includes("smtp") || m.includes("email service")) {
    return "Supabase email service not reachable. Check the project's SMTP settings.";
  }
  return raw;
}
