/*
 * Access-audit writer (GDPR Art. 30 accountability).
 *
 * Records a back-office read of another account's data into
 * public.access_audit_log. Fire-and-forget: an audit-write failure must never
 * break the read it is recording, but it is logged to the server console.
 *
 * Call from API routes that return member-level data (names, emails,
 * individual usage) for enterprise admin / department manager / channel
 * partner roles. Pass the SERVICE-ROLE client (the table has no end-user
 * INSERT policy by design).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AccessAuditEntry {
  actorUserId: string;
  actorRole: string;
  /** e.g. "org:<uuid>", "dept:<uuid>", "reseller:<uuid>". */
  tenantScope?: string | null;
  /** e.g. "enterprise.department.employees". */
  resource: string;
  /** Subjects whose data was accessed. */
  memberIds: string[];
}

export async function writeAccessAudit(
  admin: SupabaseClient,
  entry: AccessAuditEntry
): Promise<void> {
  try {
    const { error } = await admin.from("access_audit_log").insert({
      actor_user_id: entry.actorUserId,
      actor_role: entry.actorRole,
      tenant_scope: entry.tenantScope ?? null,
      resource: entry.resource,
      member_ids: entry.memberIds,
      member_count: entry.memberIds.length,
    });
    if (error) console.warn("[access-audit] insert failed:", error.message);
  } catch (e) {
    console.warn("[access-audit] write threw:", e);
  }
}
