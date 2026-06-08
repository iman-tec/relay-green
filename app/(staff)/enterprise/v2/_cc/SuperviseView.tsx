"use client";

/*
 * Enterprise Supervise tab — org-scoped, read-only live/waiting/past sessions
 * for the organization's members. Thin wrapper over the shared SuperviseBoard;
 * the enterprise feed carries engineer + recalls, so those columns show.
 *
 * Replaces the legacy standalone EnterpriseSuperviseClient (a foreign card-grid
 * shell the admin was ejected into via a /supervise link-out).
 */

import { SuperviseBoard } from "@/app/_components/portal/SuperviseBoard";

export function SuperviseView() {
  return (
    <SuperviseBoard
      endpoint="/api/enterprise/sessions?limit=200"
      personLabel="Customer"
      showEngineer
      showRecalls
    />
  );
}
