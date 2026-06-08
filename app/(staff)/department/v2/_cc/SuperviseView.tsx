"use client";

/*
 * Department Supervise tab — department-scoped, read-only live/waiting/past
 * sessions for the department's members. Thin wrapper over the shared
 * SuperviseBoard; the department feed omits engineer + recalls, so those
 * columns are hidden.
 *
 * Replaces both the old minimal Sessions list and the legacy /supervise
 * link-out that ejected the admin into the standalone StaffShell.
 */

import { SuperviseBoard } from "@/app/_components/portal/SuperviseBoard";

export function SuperviseView() {
  return (
    <SuperviseBoard
      endpoint="/api/department/sessions?limit=200"
      personLabel="Member"
    />
  );
}
