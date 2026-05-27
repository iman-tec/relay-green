/*
 * Shared invite primitive — server helpers.
 *
 * One coded, single-use, expiring link per recipient, recorded in the
 * `invites` table so status (sent/opened/accepted/expired/revoked) can be
 * tracked and the link can be resent / revoked. Used by every hierarchy
 * level (partner → company → department) through the same /api/invite surface
 * (member/admin invites) and the partner company-onboarding endpoint.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InviteScope = "partner" | "company" | "department";

export function genInviteCode(): string {
  // URL-safe single-use token.
  return randomBytes(18).toString("base64url");
}

/** Build the claim link the recipient clicks (email + code prefilled). */
export function inviteLink(code: string, email: string): string {
  const brand = process.env.NEXT_PUBLIC_BRAND_DOMAIN || "relay.green";
  return `https://${brand}/staff/login?invite=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
}

export interface RecordInviteInput {
  email: string;
  name?: string | null;
  role?: string | null;
  scopeType: InviteScope;
  scopeId: string;
  companyName?: string | null;
  departmentId?: string | null;
  invitedBy: string;
  code?: string;
}

export interface InviteRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  company_name: string | null;
  code: string;
  status: string;
  sent_at: string;
  opened_at: string | null;
  accepted_at: string | null;
  expires_at: string;
}

/** Insert an invite row (service-role) and return it + the claim link. */
export async function recordInvite(
  admin: SupabaseClient,
  input: RecordInviteInput,
): Promise<{ row: InviteRow; link: string } | { error: string }> {
  const code = input.code ?? genInviteCode();
  const { data, error } = await admin
    .from("invites")
    .insert({
      email:         input.email.trim().toLowerCase(),
      name:          input.name ?? null,
      role:          input.role ?? null,
      scope_type:    input.scopeType,
      scope_id:      input.scopeId,
      company_name:  input.companyName ?? null,
      department_id: input.departmentId ?? null,
      code,
      invited_by:    input.invitedBy,
    })
    .select("id, email, name, role, company_name, code, status, sent_at, opened_at, accepted_at, expires_at")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not record invite" };
  return { row: data as InviteRow, link: inviteLink(code, (data as InviteRow).email) };
}
