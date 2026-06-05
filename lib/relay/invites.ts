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
import { loginUrlForInvitedRole } from "@/lib/relay/loginSurface";

export type InviteScope = "partner" | "company" | "department";

export function genInviteCode(): string {
  // URL-safe single-use token.
  return randomBytes(18).toString("base64url");
}

/**
 * Build the claim link the recipient clicks (email + code prefilled).
 *
 * The login URL is chosen by the invited role so the recipient lands on
 * the surface their account is admitted on:
 *   reseller                          → /partner
 *   enterprise_admin, department_admin → /business
 *   client (invited via a department)  → /business
 *   super_admin, supervisor, engineer  → /staff
 *   anything else / unknown            → /login (customer default)
 *
 * If the role is null we fall back to /login so a generic invite still
 * works for customers signing up directly.
 */
export function inviteLink(
  code: string,
  email: string,
  role?: string | null
): string {
  const brand = process.env.NEXT_PUBLIC_BRAND_DOMAIN || "relay.green";
  const path = loginUrlForInvitedRole(role);
  return `https://${brand}${path}?invite=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
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
  input: RecordInviteInput
): Promise<{ row: InviteRow; link: string } | { error: string }> {
  const code = input.code ?? genInviteCode();
  const { data, error } = await admin
    .from("invites")
    .insert({
      email: input.email.trim().toLowerCase(),
      name: input.name ?? null,
      role: input.role ?? null,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      company_name: input.companyName ?? null,
      department_id: input.departmentId ?? null,
      code,
      invited_by: input.invitedBy,
    })
    .select(
      "id, email, name, role, company_name, code, status, sent_at, opened_at, accepted_at, expires_at"
    )
    .single();
  if (error || !data)
    return { error: error?.message ?? "Could not record invite" };
  return {
    row: data as InviteRow,
    link: inviteLink(code, (data as InviteRow).email, (data as InviteRow).role),
  };
}
