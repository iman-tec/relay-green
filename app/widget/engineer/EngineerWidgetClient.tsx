"use client";

/*
 * Engineer widget — hidden BrowserWindow that the Relay desktop shell keeps
 * alive while the engineer is signed in. Its job is to surface incoming
 * customer calls as OS-level desktop notifications (tray flash + native
 * Accept/Decline popup) even when the main app window is closed or hidden.
 *
 * Single listener: MatchOfferBridge. It subscribes to engineer_match_offers
 * in realtime and drives the `window.relay.*` IPC bridge — no in-window UI,
 * no changes to the match RPCs, no duplicate ringing.
 *
 * The in-app modal (EngineerIncomingMatch, mounted in StaffShell) handles
 * the user-visible card when the engineer is on /dashboard etc. Both
 * consume the same underlying offer row independently.
 */

import { MatchOfferBridge } from "./MatchOfferBridge";

export function EngineerWidgetClient() {
  return <MatchOfferBridge />;
}
