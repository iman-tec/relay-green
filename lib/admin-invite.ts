/*
 * Centralized invitation-email plumbing.
 *
 * Supabase's auth admin SDK splits the "send a sign-in email" surface
 * across three different calls, and only some of them actually trigger
 * an email through SMTP:
 *
 *   • inviteUserByEmail   — creates + emails (works for new accounts).
 *                            For an existing-but-unconfirmed user,
 *                            it resends the invite.
 *                            Fails for existing-confirmed users.
 *   • signInWithOtp       — public-client call, always sends a magic
 *                            link email if SMTP is configured.
 *                            Works for confirmed users; we pass
 *                            shouldCreateUser:false so it errors instead
 *                            of silently creating new auth rows.
 *   • generateLink        — returns a URL only. Whether it triggers an
 *                            email depends on the GoTrue version and
 *                            project config — DO NOT rely on it.
 *
 * `sendInvitationEmail` picks the right one automatically. Callers get
 * one consistent shape: { ok: true, userId? } or { ok: false, error }.
 */

import { createClient as createAnonClient, type SupabaseClient } from "@supabase/supabase-js";

export type InvitePayload = {
  /** Recipient — lowercased + trimmed inside. */
  email:        string;
  /** Display name written to user_metadata. Optional. */
  displayName?: string;
  /** Free-form metadata merged into user_metadata (org_id, role_label, …). */
  metadata?:    Record<string, unknown>;
};

export type InviteResult =
  | { ok: true;  mode: "invited" | "magic_link"; userId?: string }
  | { ok: false; error: string };

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "http://localhost:3001";

const REDIRECT_TO = `${APP_URL}/auth/callback?next=/auth/post-signin`;

/**
 * Send an invitation / sign-in email.
 *
 * @param admin   service-role Supabase client (so we can call auth.admin.*)
 * @param payload caller-provided email + metadata
 */
export async function sendInvitationEmail(
  admin: SupabaseClient,
  payload: InvitePayload,
): Promise<InviteResult> {
  const email = payload.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  const userMeta: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    ...(payload.displayName ? { display_name: payload.displayName } : {}),
  };

  // Step 1 — try inviteUserByEmail. Handles new + unconfirmed users.
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data:        userMeta,
    redirectTo:  REDIRECT_TO,
  });

  if (!invite.error && invite.data?.user) {
    return { ok: true, mode: "invited", userId: invite.data.user.id };
  }

  // Step 2 — Supabase says the user already exists (confirmed). Fall
  // back to signInWithOtp via a public client, which is the only call
  // guaranteed to send a magic-link email for a confirmed user.
  const msg = (invite.error?.message ?? "").toLowerCase();
  const alreadyExists =
    msg.includes("already") ||
    msg.includes("registered") ||
    msg.includes("exists");

  if (alreadyExists) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return { ok: false, error: "Supabase env not configured for magic-link fallback." };
    }
    const anon = createAnonClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: otpErr } = await anon.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:  REDIRECT_TO,
        shouldCreateUser: false,
      },
    });
    if (otpErr) {
      return { ok: false, error: explainSmtp(otpErr.message) };
    }
    return { ok: true, mode: "magic_link" };
  }

  return { ok: false, error: explainSmtp(invite.error?.message ?? "Invite failed.") };
}

/**
 * Resend an invite to an already-existing user (used by the
 * Mail / "resend invite" icons in the admin tables).
 */
export async function resendInvitationEmail(
  admin: SupabaseClient,
  userId: string,
): Promise<InviteResult> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    return { ok: false, error: error?.message ?? "User not found." };
  }
  // inviteUserByEmail re-sends for unconfirmed users; for confirmed
  // users it'll error and we'll fall back to magic-link.
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
