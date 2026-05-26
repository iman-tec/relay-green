import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile & settings — Relay.green",
};

/*
 * /settings is a thin shell — the actual UI is rendered IN-PLACE inside
 * StaffShell as <EngineerProfilePane> via shell state. The shell watches
 * for pathname === "/settings" and auto-opens the pane (see StaffShell).
 *
 * This page intentionally renders no content of its own. Closing the
 * pane navigates the user back to /dashboard.
 */
export default function SettingsPage() {
  return null;
}
