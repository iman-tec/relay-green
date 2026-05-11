/*
 * Audit logging utility (RG-0103).
 *
 * Centralized writer for the AuditLog entity. Sensitive operations across the
 * platform should call `auditLog()` to record actor + action + entity metadata.
 *
 * See docs/RelayGreen_Technical_Architecture_v1.md §4.22 (AuditLog) and §9
 * (Audit Events v1) for the list of actions that must be audited.
 */

import { prisma } from "./db";

export type AuditableAction =
  | "USER_LOGIN"
  | "ORGANIZATION_CODE_USE"
  | "ENTERPRISE_WALLET_CHANGE"
  | "SPEND_LIMIT_CHANGE"
  | "ENGINEER_ASSIGNMENT"
  | "SESSION_STATE_CHANGE"
  | "RECORDING_CONSENT"
  | "REMOTE_CONTROL_GRANT"
  | "REMOTE_CONTROL_REVOKE"
  | "SUPERVISOR_JOIN"
  | "SUPERVISOR_TAKEOVER"
  | "CUSTOMER_CREDIT"
  | "ENGINEER_REMOVED_FROM_AVAILABILITY"
  | "ENTERPRISE_EXPORT"
  | "ADMIN_ACCESS_TO_SESSION_CONTENT"
  | "BUCKET_PURCHASE"
  | "BUCKET_REFUND"
  | "BONUS_OVERRIDE_CHANGE"
  | "ALIAS_CHANGE"
  | "DEMO_DATA_SEEDED";

interface AuditPayload {
  actorUserId: string;
  action: AuditableAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function auditLog(payload: AuditPayload): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: payload.actorUserId,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: (payload.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    // Audit must never break the user-facing operation; log and continue.
    console.error("[audit] failed to write entry", payload, err);
  }
}
