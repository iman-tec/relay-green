/*
 * /staff segment layout (login, onboarding, project/[id], session/[id]).
 *
 * These routes live OUTSIDE the app/(staff) route group (they carry the
 * /staff URL prefix and skip the StaffShell chrome), which meant the
 * engineer's incoming-call ring — mounted inside StaffShell — never
 * rendered here: an engineer reading /staff/project/[id] missed rings
 * entirely.
 *
 * Mounting EngineerIncomingMatch ONCE at this segment root (not copied
 * into pages) makes the ring global across the whole staff surface:
 *   • it self-gates on auth + a pending offer for THIS user, so it's
 *     inert on /staff/login and for non-engineers;
 *   • it self-suppresses on /staff/session/* (already in/joining a call —
 *     no competing full-screen ring; the offer escalates server-side);
 *   • it persists across client-side navigation because layouts don't
 *     remount between sibling routes.
 */

import { EngineerIncomingMatch } from "@/app/_components/EngineerIncomingMatch";

export default function StaffSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <EngineerIncomingMatch />
    </>
  );
}
