"use client";

/*
 * Engineer widget — runs the incoming-call listener inside the Relay desktop
 * shell. Mounted by the Electron shell into a hidden BrowserWindow so the
 * engineer receives ring + (Day 4) tray flash + native notification even when
 * the main app window is closed.
 *
 * Reuses `EngineerIncomingRequest` which:
 *   - subscribes to guest_calls realtime
 *   - plays a 660 Hz ring tone while a queue head exists
 *   - exposes Accept (claim_session RPC + navigate to /staff/session/[id])
 *     and Decline (local dismiss)
 *
 * In v1 this page is intentionally invisible. The orb is the user-facing
 * surface; this just hosts the listener.
 */

import { EngineerIncomingRequest } from "@/app/_components/EngineerIncomingRequest";

export function EngineerWidgetClient() {
  return <EngineerIncomingRequest />;
}
